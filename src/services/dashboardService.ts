/**
 * dashboardService — สรุปตัวเลขสำหรับหน้า dashboard (aggregate จากหลายคอลเลกชัน)
 *
 * ข้อสังเกต:
 *  - "รายได้" นับจากออเดอร์ปกติ + พรีออเดอร์ ที่ payment_status = "paid" และไม่ถูกลบ (พรีออเดอร์รวมตั้งแต่ BACKLOG4 R5)
 *  - "กำไรโดยประมาณ" = รายได้ − ค่าใช้จ่ายในช่วง − ต้นทุนสินค้าขาย (COGS จาก cost_per_unit ของ orderItems + preorderItems)
 *  - ช่วงวันที่อ้างอิง created_at ของออเดอร์
 */
import dbConnect from "../lib/dbConnect";
import { bangkokDateString } from "../lib/datetime";
import orderModel from "../models/orderModel";
import orderItemModel from "../models/orderItemModel";
import preorderModel from "../models/preorderModel";
import preorderItemModel from "../models/preorderItemModel";
import productModel from "../models/productModel";
import ingredientModel from "../models/ingredientModel";
import * as expenseService from "./expenseService";
import { toBaht, round2 } from "../lib/money";
import { LOW_STOCK_EXPR } from "../lib/lowStock";

/* eslint-disable @typescript-eslint/no-explicit-any */

function rangeMatch(dateFrom?: string, dateTo?: string): Record<string, any> {
  const m: Record<string, any> = { deleted_at: null };
  if (dateFrom || dateTo) {
    m.created_at = {};
    if (dateFrom) m.created_at.$gte = new Date(dateFrom);
    if (dateTo) m.created_at.$lte = new Date(dateTo);
  }
  return m;
}

// ── แหล่งยอดขาย: ออเดอร์ปกติ + พรีออเดอร์ ─────────────────────
// docs/BACKLOG4.md R5 — เดิม overview/salesByDay/topProducts อ่านแค่ orders → รายได้/กำไรพรีออเดอร์ (ช่องทางหลักของร้าน)
// หายจากแดชบอร์ดทั้งหมด · ตอนนี้รวมทั้งสองแหล่ง (โครงเอกสารเหมือนกัน: total_amount/discount_amount/payment_status ·
// รายการมี quantity/total_price/cost_per_unit/product_snapshot เหมือนกัน · เงินเป็นบาท)
type SourceKey = "orders" | "preorders";
const SOURCES: Record<SourceKey, { model: any; itemModel: any; fk: "order_id" | "preorder_id" }> = {
  orders: { model: orderModel, itemModel: orderItemModel, fk: "order_id" },
  preorders: { model: preorderModel, itemModel: preorderItemModel, fk: "preorder_id" },
};
const SOURCE_KEYS = Object.keys(SOURCES) as SourceKey[];

/** pipeline: รายการสินค้า join เอกสารแม่ แล้วกรองเอกสารแม่ด้วย parentMatch (คีย์ของเอกสารแม่ตรง ๆ) */
function joinedItems(key: SourceKey, parentMatch: Record<string, any>): any[] {
  const src = SOURCES[key];
  return [
    { $match: { deleted_at: null } },
    { $lookup: { from: src.model.collection.name, localField: src.fk, foreignField: "_id", as: "parent" } },
    { $unwind: "$parent" },
    { $match: Object.fromEntries(Object.entries(parentMatch).map(([k, v]) => [`parent.${k}`, v])) },
  ];
}

// ── ภาพรวม ─────────────────────────────────────────────────
export async function overview(opts: { date_from?: string; date_to?: string } = {}) {
  await dbConnect();
  const match = rangeMatch(opts.date_from, opts.date_to);
  const paidMatch = { ...match, payment_status: "paid" };

  const perSource = await Promise.all(
    SOURCE_KEYS.map(async (key) => {
      const src = SOURCES[key];
      const [statusRows, paidRows, cogsRows] = await Promise.all([
        src.model.aggregate([{ $match: match }, { $group: { _id: "$order_status", count: { $sum: 1 } } }]),
        src.model.aggregate([
          { $match: paidMatch },
          {
            $group: {
              _id: null,
              revenue: { $sum: "$total_amount" },
              discount: { $sum: "$discount_amount" },
              orders: { $sum: 1 },
            },
          },
        ]),
        src.itemModel.aggregate([
          ...joinedItems(key, paidMatch),
          { $group: { _id: null, cogs: { $sum: { $multiply: [{ $ifNull: ["$cost_per_unit", 0] }, "$quantity"] } } } },
        ]),
      ]);
      return {
        key,
        statusRows: statusRows as Array<{ _id: string; count: number }>,
        revenue: paidRows[0]?.revenue ?? 0,
        discount: paidRows[0]?.discount ?? 0,
        paid: paidRows[0]?.orders ?? 0,
        cogs: cogsRows[0]?.cogs ?? 0,
      };
    })
  );

  const [lowProducts, lowIngredients, expenseTotal] = await Promise.all([
    productModel.countDocuments({
      deleted_at: null,
      is_preorder: { $ne: true }, // สินค้าปกติ (มีสต็อก)
      product_stock_quantity: { $ne: null },
      ...LOW_STOCK_EXPR, // เกณฑ์รายสินค้า (low_stock_threshold ?? 5) — src/lib/lowStock.ts
    }),
    ingredientModel.countDocuments({
      deleted_at: null,
      $expr: { $lte: ["$current_stock", "$reorder_point"] },
    }),
    expenseService.totalInRange(
      opts.date_from ? new Date(opts.date_from) : undefined,
      opts.date_to ? new Date(opts.date_to) : undefined
    ),
  ]);

  // total_amount/discount_amount/cost_per_unit/expenseTotal เป็นบาททั้งหมด — รวมค่าดิบก่อนแล้วปัด 2 ตำแหน่งครั้งเดียว
  // (กัน float สะสมในสูตร profit_estimate · docs/money-units.md)
  const sum = (f: "revenue" | "discount" | "paid" | "cogs") => perSource.reduce((s, p) => s + p[f], 0);
  const revenue = toBaht(sum("revenue"));
  const discount = toBaht(sum("discount"));
  const cogs = toBaht(sum("cogs"));
  const paidOrders = sum("paid");

  const byStatus: Record<string, number> = {};
  let totalOrders = 0;
  const bySource: Record<string, { total: number; paid: number; revenue: number; cogs: number }> = {};
  for (const p of perSource) {
    let total = 0;
    for (const r of p.statusRows) {
      byStatus[r._id] = (byStatus[r._id] ?? 0) + r.count;
      total += r.count;
    }
    totalOrders += total;
    bySource[p.key] = { total, paid: p.paid, revenue: round2(toBaht(p.revenue)), cogs: round2(toBaht(p.cogs)) };
  }

  return {
    range: { date_from: opts.date_from ?? null, date_to: opts.date_to ?? null },
    // ค่าทุกช่องด้านล่างรวมออเดอร์ปกติ + พรีออเดอร์แล้ว · แยกดูได้ที่ by_source
    orders: { total: totalOrders, by_status: byStatus, paid: paidOrders },
    revenue: round2(revenue),
    discount_given: round2(discount),
    avg_order_value: paidOrders ? round2(revenue / paidOrders) : 0,
    expenses: round2(expenseTotal),
    cogs: round2(cogs),
    profit_estimate: round2(revenue - expenseTotal - cogs),
    by_source: bySource,
    low_stock: { products: lowProducts, ingredients: lowIngredients },
  };
}

// ── ยอดขายรายวัน ───────────────────────────────────────────
export async function salesByDay(opts: { days?: number } = {}) {
  await dbConnect();
  const days = Math.min(180, Math.max(1, Number(opts.days) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const perSource = await Promise.all(
    SOURCE_KEYS.map((key) =>
      SOURCES[key].model.aggregate([
        { $match: { deleted_at: null, payment_status: "paid", created_at: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at", timezone: "Asia/Bangkok" } },
            revenue: { $sum: "$total_amount" },
            orders: { $sum: 1 },
          },
        },
      ]) as Promise<Array<{ _id: string; revenue: number; orders: number }>>
    )
  );

  const byDate = new Map<string, { revenue: number; orders: number }>();
  for (const rows of perSource) {
    for (const r of rows) {
      const cur = byDate.get(r._id) ?? { revenue: 0, orders: 0 };
      cur.revenue += r.revenue;
      cur.orders += r.orders;
      byDate.set(r._id, cur);
    }
  }

  return {
    from: bangkokDateString(since),
    to: bangkokDateString(new Date()),
    series: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        revenue: round2(toBaht(v.revenue)), // บาท ปัด 2 ตำแหน่ง
        orders: v.orders, // รวมออเดอร์ปกติ + พรีออเดอร์
      })),
  };
}

// ── สินค้าขายดี ────────────────────────────────────────────
export async function topProducts(opts: {
  limit?: number;
  date_from?: string;
  date_to?: string;
} = {}) {
  await dbConnect();
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 10));

  const parentMatch: Record<string, any> = { deleted_at: null, payment_status: "paid" };
  if (opts.date_from || opts.date_to) {
    parentMatch.created_at = {};
    if (opts.date_from) parentMatch.created_at.$gte = new Date(opts.date_from);
    if (opts.date_to) parentMatch.created_at.$lte = new Date(opts.date_to);
  }

  // รวมต่อสินค้าจากทั้งสองแหล่ง แล้วค่อยเรียง/ตัด limit (สินค้าหนึ่งขายได้ทั้งแบบปกติและพรีออเดอร์ไม่ได้ แต่ไม่ต้องสมมติ)
  const perSource = await Promise.all(
    SOURCE_KEYS.map(
      (key) =>
        SOURCES[key].itemModel.aggregate([
          ...joinedItems(key, parentMatch),
          {
            $group: {
              _id: "$product_id",
              qty: { $sum: "$quantity" },
              revenue: { $sum: "$total_price" },
              name: { $first: "$product_snapshot.product_name_th" },
            },
          },
        ]) as Promise<Array<{ _id: unknown; qty: number; revenue: number; name: string }>>
    )
  );

  const byProduct = new Map<string, { qty: number; revenue: number; name: string }>();
  for (const rows of perSource) {
    for (const r of rows) {
      const id = String(r._id);
      const cur = byProduct.get(id) ?? { qty: 0, revenue: 0, name: r.name };
      cur.qty += r.qty;
      cur.revenue += r.revenue;
      byProduct.set(id, cur);
    }
  }

  return {
    items: [...byProduct.entries()]
      .sort(([, a], [, b]) => b.qty - a.qty)
      .slice(0, limit)
      .map(([id, v]) => ({
        product_id: id,
        product_name_th: v.name,
        quantity_sold: v.qty,
        revenue: round2(toBaht(v.revenue)), // บาท ปัด 2 ตำแหน่ง
      })),
  };
}

// ── รายรับแยกตามช่องทางออเดอร์ (หน้าสรุปกำไร-ขาดทุน) ──────────────
export type RevenueChannel = "web" | "pos" | "preorder" | "other";

/** ช่องทางจากเลขเอกสาร — ORD- เว็บไซต์ / POS- หน้าร้าน / PRE- พรีออเดอร์ · เลขรุ่นเก่าก่อนแยก prefix (OP-, WEB- ฯลฯ) = other */
export function orderChannelOf(orderNo: unknown): RevenueChannel {
  if (typeof orderNo !== "string") return "other";
  if (orderNo.startsWith("ORD-")) return "web";
  if (orderNo.startsWith("POS-")) return "pos";
  if (orderNo.startsWith("PRE-")) return "preorder";
  return "other";
}

/**
 * รายรับ (ชำระแล้ว ไม่ถูกลบ ในช่วงวันที่ตาม created_at) แยกตามช่องทาง — docs/BACKLOG2.md §14 (2026-09-30):
 * เลิกแยกประเภทสินค้าตามช่องทางขายแล้ว ช่องทางดูจาก "ออเดอร์" แทน
 *   web      = ออเดอร์เว็บไซต์ (ORD-)          ← orders
 *   pos      = ออเดอร์หน้าร้าน (POS-)          ← orders
 *   preorder = พรีออเดอร์ (PRE-)               ← preorders (เดิมรายงานแบบแยกประเภทสินค้าไม่ได้นับ collection นี้เลย)
 *   other    = ออเดอร์เลขรุ่นเก่าก่อนแยก prefix (OP-, WEB- ฯลฯ) — ระบุช่องทางย้อนหลังไม่ได้
 * ใช้ total_amount ของออเดอร์ทั้งก้อน (รวมค่าส่ง − ส่วนลด) — ออเดอร์หนึ่งอยู่ช่องทางเดียว ไม่ต้องกระจายสัดส่วน
 * คืนเป็นบาท (ปัด 2 ตำแหน่งตอนท้ายสุด) + จำนวนออเดอร์ต่อช่องทาง
 */
export async function revenueByChannel(opts: { date_from?: string; date_to?: string } = {}) {
  await dbConnect();
  const match = { ...rangeMatch(opts.date_from, opts.date_to), payment_status: "paid" };
  const [orders, preorders] = await Promise.all([
    orderModel.find(match).select("order_no total_amount").lean<Array<{ order_no?: string; total_amount: number }>>(),
    preorderModel.find(match).select("total_amount").lean<Array<{ total_amount: number }>>(),
  ]);

  const sums: Record<RevenueChannel, number> = { web: 0, pos: 0, preorder: 0, other: 0 };
  const counts: Record<RevenueChannel, number> = { web: 0, pos: 0, preorder: 0, other: 0 };
  for (const o of orders) {
    const ch = orderChannelOf(o.order_no);
    sums[ch] += o.total_amount;
    counts[ch] += 1;
  }
  for (const p of preorders) {
    sums.preorder += p.total_amount;
    counts.preorder += 1;
  }

  const total = sums.web + sums.pos + sums.preorder + sums.other;
  return {
    web: toBaht(sums.web),
    pos: toBaht(sums.pos),
    preorder: toBaht(sums.preorder),
    other: toBaht(sums.other),
    total: toBaht(total),
    counts,
    orders: orders.length + preorders.length,
  };
}
