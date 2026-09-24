/**
 * dashboardService — สรุปตัวเลขสำหรับหน้า dashboard (aggregate จากหลายคอลเลกชัน)
 *
 * ข้อสังเกต:
 *  - "รายได้" นับจากออเดอร์ที่ payment_status = "paid" และไม่ถูกลบ
 *  - "กำไรโดยประมาณ" = รายได้ − ค่าใช้จ่ายในช่วง − ต้นทุนสินค้าขาย (COGS จาก orderItems.cost_per_unit ถ้ามี)
 *  - ช่วงวันที่อ้างอิง created_at ของออเดอร์
 */
import dbConnect from "../lib/dbConnect";
import { bangkokDateString } from "../lib/datetime";
import orderModel from "../models/orderModel";
import orderItemModel from "../models/orderItemModel";
import productModel from "../models/productModel";
import ingredientModel from "../models/ingredientModel";
import * as expenseService from "./expenseService";
import { toBaht, round2 } from "../lib/money";

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

// ── ภาพรวม ─────────────────────────────────────────────────
export async function overview(opts: { date_from?: string; date_to?: string } = {}) {
  await dbConnect();
  const match = rangeMatch(opts.date_from, opts.date_to);

  const [statusRows, paidRows, cogsRows, lowProducts, lowIngredients, expenseTotal] =
    await Promise.all([
      orderModel.aggregate([
        { $match: match },
        { $group: { _id: "$order_status", count: { $sum: 1 } } },
      ]),
      orderModel.aggregate([
        { $match: { ...match, payment_status: "paid" } },
        {
          $group: {
            _id: null,
            revenue: { $sum: "$total_amount" },
            discount: { $sum: "$discount_amount" },
            orders: { $sum: 1 },
          },
        },
      ]),
      orderItemModel.aggregate([
        { $match: { deleted_at: null } },
        {
          $lookup: {
            from: orderModel.collection.name,
            localField: "order_id",
            foreignField: "_id",
            as: "order",
          },
        },
        { $unwind: "$order" },
        {
          $match: {
            "order.deleted_at": null,
            "order.payment_status": "paid",
            ...(match.created_at ? { "order.created_at": match.created_at } : {}),
          },
        },
        {
          $group: {
            _id: null,
            cogs: {
              $sum: {
                $multiply: [{ $ifNull: ["$cost_per_unit", 0] }, "$quantity"],
              },
            },
          },
        },
      ]),
      productModel.countDocuments({
        deleted_at: null,
        product_types: { $ne: "preorder" }, // สินค้าที่มีสต็อก (inStore/online)
        product_stock_quantity: { $ne: null, $lte: 5 },
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

  // BACKLOG §3.11 — orderModel.total_amount/discount_amount เป็นสตางค์ (เฟส 1) และตั้งแต่เฟส 4
  // orderItem.cost_per_unit ก็เป็นสตางค์ด้วยเช่นกัน (aggregate $sum ของทั้งคู่ได้ผลรวมเป็นสตางค์)
  // expenseTotal (จาก expenseService.totalInRange) คืนบาทให้อยู่แล้วตั้งแต่เฟส 2 — แปลง
  // revenue/discount/cogs เป็นบาทให้ครบก่อนเอามารวมกันในสูตร profit_estimate ไม่งั้นหน่วยจะปนกัน
  const revenue = toBaht(paidRows[0]?.revenue ?? 0);
  const discount = toBaht(paidRows[0]?.discount ?? 0);
  const cogs = toBaht(cogsRows[0]?.cogs ?? 0);
  const paidOrders = paidRows[0]?.orders ?? 0;

  const byStatus: Record<string, number> = {};
  let totalOrders = 0;
  for (const r of statusRows) {
    byStatus[r._id] = r.count;
    totalOrders += r.count;
  }

  return {
    range: { date_from: opts.date_from ?? null, date_to: opts.date_to ?? null },
    orders: { total: totalOrders, by_status: byStatus, paid: paidOrders },
    revenue: round2(revenue),
    discount_given: round2(discount),
    avg_order_value: paidOrders ? round2(revenue / paidOrders) : 0,
    expenses: round2(expenseTotal),
    cogs: round2(cogs),
    profit_estimate: round2(revenue - expenseTotal - cogs),
    low_stock: { products: lowProducts, ingredients: lowIngredients },
  };
}

// ── ยอดขายรายวัน ───────────────────────────────────────────
export async function salesByDay(opts: { days?: number } = {}) {
  await dbConnect();
  const days = Math.min(180, Math.max(1, Number(opts.days) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await orderModel.aggregate([
    { $match: { deleted_at: null, payment_status: "paid", created_at: { $gte: since } } },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$created_at", timezone: "Asia/Bangkok" },
        },
        revenue: { $sum: "$total_amount" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    from: bangkokDateString(since),
    to: bangkokDateString(new Date()),
    series: rows.map((r) => ({
      date: r._id,
      revenue: round2(toBaht(r.revenue)), // total_amount เป็นสตางค์ (BACKLOG §3.11)
      orders: r.orders,
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

  const orderMatch: Record<string, any> = { deleted_at: null, payment_status: "paid" };
  if (opts.date_from || opts.date_to) {
    orderMatch.created_at = {};
    if (opts.date_from) orderMatch.created_at.$gte = new Date(opts.date_from);
    if (opts.date_to) orderMatch.created_at.$lte = new Date(opts.date_to);
  }

  const rows = await orderItemModel.aggregate([
    { $match: { deleted_at: null } },
    {
      $lookup: {
        from: orderModel.collection.name,
        localField: "order_id",
        foreignField: "_id",
        as: "order",
      },
    },
    { $unwind: "$order" },
    {
      $match: Object.fromEntries(
        Object.entries(orderMatch).map(([k, v]) => [`order.${k}`, v])
      ),
    },
    {
      $group: {
        _id: "$product_id",
        qty: { $sum: "$quantity" },
        revenue: { $sum: "$total_price" },
        name: { $first: "$product_snapshot.product_name_th" },
      },
    },
    { $sort: { qty: -1 } },
    { $limit: limit },
  ]);

  return {
    items: rows.map((r) => ({
      product_id: String(r._id),
      product_name_th: r.name,
      quantity_sold: r.qty,
      revenue: round2(toBaht(r.revenue)), // orderItem.total_price เป็นสตางค์ (BACKLOG §3.11)
    })),
  };
}

// ── รายรับแยกตามประเภทสินค้า (หน้าสรุปกำไร-ขาดทุน) ────────────────
export type ProductTypeKey = "inStore" | "online" | "preorder";

/**
 * รายรับ (ออเดอร์ที่ชำระแล้ว ไม่ถูกลบ ในช่วงวันที่) แยกตาม product_types ของสินค้าในออเดอร์
 *
 * - ประเภทสินค้าไม่ได้เก็บไว้กับรายการในออเดอร์ (product_snapshot มีแค่ชื่อ) จึงอ้างจาก product_types
 *   "ปัจจุบัน" ของสินค้า — ถ้าเปลี่ยนประเภทสินค้าภายหลัง ออเดอร์เก่าจะย้ายกลุ่มตามไปด้วย
 * - สินค้าเลือกได้มากกว่า 1 ประเภทตั้งแต่แก้ docs/BACKLOG2.md §14 (inStore+online พร้อมกันได้) แต่ตัว
 *   บัคเก็ตของรายงานนี้ยังต้องเป็นค่าเดียวต่อสินค้า (กันนับซ้ำ — ผลรวมทุกกลุ่มต้องตรงกับ total_amount
 *   เป๊ะเสมอ) เลือกบัคเก็ตด้วยลำดับความสำคัญ inStore > online > preorder (preorder ไม่ผสมกับตัวอื่น
 *   อยู่แล้ว ไม่มีทางกำกวม) — ดู primaryTypeOf() ด้านล่าง
 * - ผลรวมทุกกลุ่ม = ผลรวม total_amount ของออเดอร์ตรงเป๊ะ: ส่วนที่นอกเหนือจากราคาสินค้า (ค่าส่ง − ส่วนลดระดับออเดอร์)
 *   กระจายตามสัดส่วนยอดสินค้าของแต่ละประเภทในออเดอร์นั้น (คิดเป็นสตางค์ integer เศษปัดเข้ากลุ่มที่ใหญ่สุด)
 * - รายการที่หาสินค้าไม่เจอ (ถูกลบ/ไม่มีข้อมูล) หรือออเดอร์ที่ไม่มีรายการเลย → "unclassified"
 * คืนเป็นบาท (แปลงจากสตางค์ตอนท้ายสุด)
 */
function primaryTypeOf(types: string[] | undefined): ProductTypeKey | undefined {
  if (!Array.isArray(types)) return undefined;
  if (types.includes("inStore")) return "inStore";
  if (types.includes("online")) return "online";
  if (types.includes("preorder")) return "preorder";
  return undefined;
}
export async function revenueByProductType(opts: { date_from?: string; date_to?: string } = {}) {
  await dbConnect();
  const orders = await orderModel
    .find({ ...rangeMatch(opts.date_from, opts.date_to), payment_status: "paid" })
    .select("total_amount")
    .lean<Array<{ _id: any; total_amount: number }>>();

  const KEYS = ["inStore", "online", "preorder", "unclassified"] as const;
  type Bucket = (typeof KEYS)[number];
  const sums: Record<Bucket, number> = { inStore: 0, online: 0, preorder: 0, unclassified: 0 };

  if (orders.length > 0) {
    const items = await orderItemModel
      .find({ order_id: { $in: orders.map((o) => o._id) }, deleted_at: null })
      .select("order_id product_id total_price")
      .lean<Array<{ order_id: any; product_id: any; total_price: number }>>();
    const productIds = [...new Set(items.map((i) => String(i.product_id)))];
    const products = productIds.length
      ? await productModel
          .find({ _id: { $in: productIds } })
          .select("product_types")
          .lean<Array<{ _id: any; product_types?: string[] }>>()
      : [];
    const typeOf = new Map(products.map((p) => [String(p._id), primaryTypeOf(p.product_types)]));

    const byOrder = new Map<string, Record<Bucket, number>>();
    for (const it of items) {
      const type = typeOf.get(String(it.product_id));
      const bucket: Bucket = type === "inStore" || type === "online" || type === "preorder" ? type : "unclassified";
      const row = byOrder.get(String(it.order_id)) ?? { inStore: 0, online: 0, preorder: 0, unclassified: 0 };
      row[bucket] += it.total_price;
      byOrder.set(String(it.order_id), row);
    }

    for (const o of orders) {
      const parts = byOrder.get(String(o._id));
      const itemsSum = parts ? KEYS.reduce((s, k) => s + parts[k], 0) : 0;
      if (!parts || itemsSum <= 0) {
        sums.unclassified += o.total_amount;
        continue;
      }
      // กระจาย total_amount ตามสัดส่วนยอดสินค้า — เศษที่ปัดแล้วไม่ลงตัวให้กลุ่มที่ใหญ่สุด รวมแล้วตรง total_amount เสมอ
      const alloc = Object.fromEntries(KEYS.map((k) => [k, Math.round((o.total_amount * parts[k]) / itemsSum)])) as Record<Bucket, number>;
      const drift = o.total_amount - KEYS.reduce((s, k) => s + alloc[k], 0);
      if (drift !== 0) {
        const largest = KEYS.reduce((a, b) => (parts[b] > parts[a] ? b : a));
        alloc[largest] += drift;
      }
      for (const k of KEYS) sums[k] += alloc[k];
    }
  }

  return {
    in_store: toBaht(sums.inStore),
    online: toBaht(sums.online),
    preorder: toBaht(sums.preorder),
    unclassified: toBaht(sums.unclassified),
    total: toBaht(KEYS.reduce((s, k) => s + sums[k], 0)),
    orders: orders.length,
  };
}
