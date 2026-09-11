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
        product_type: { $ne: "preorder" }, // สินค้าที่มีสต็อก (inStore/online)
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

  const revenue = paidRows[0]?.revenue ?? 0;
  const cogs = cogsRows[0]?.cogs ?? 0;
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
    revenue: Math.round(revenue * 100) / 100,
    discount_given: Math.round((paidRows[0]?.discount ?? 0) * 100) / 100,
    avg_order_value: paidOrders ? Math.round((revenue / paidOrders) * 100) / 100 : 0,
    expenses: Math.round(expenseTotal * 100) / 100,
    cogs: Math.round(cogs * 100) / 100,
    profit_estimate: Math.round((revenue - expenseTotal - cogs) * 100) / 100,
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
      revenue: Math.round(r.revenue * 100) / 100,
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
      revenue: Math.round(r.revenue * 100) / 100,
    })),
  };
}
