/**
 * productStockHistoryService — ประวัติสต็อกสินค้า (ProductStockTransactions)
 *
 * productService เรียก record() หลังอัปเดตสต็อกสำเร็จทุกทาง (ตั้งยอด/ปรับส่วนต่าง/ขาย/คืนสต็อก/ปิดงานผลิต)
 * ผู้เรียก productService ส่งแค่ context (StockLogContext — ผู้ทำ/หมายเหตุ/เอกสารต้นทาง) · ยอดก่อน/หลังมาจากผล update
 *
 * best-effort: สต็อกเปลี่ยนไปแล้ว — บันทึกประวัติไม่สำเร็จจะ log error ไม่ย้อนสต็อก/ไม่ล้มคำขอ
 */
import type { Types } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { buildMeta, type Pagination } from "../lib/queryParams";
import { log } from "../lib/logger";
import productStockTransactionModel, {
  PRODUCT_STOCK_REF_TYPES,
  PRODUCT_STOCK_TXN_TYPES,
} from "../models/productStockTransactionModel";
import orderModel from "../models/orderModel";
import productionOrderModel from "../models/productionOrderModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ProductStockTxnType = (typeof PRODUCT_STOCK_TXN_TYPES)[number];
export type ProductStockRefType = (typeof PRODUCT_STOCK_REF_TYPES)[number];

/** context จากผู้เรียก productService — ไม่ส่ง type = เดาจากทาง (ตั้งยอด = adjust · +/− = receive/use) */
export interface StockLogContext {
  type?: ProductStockTxnType;
  note?: string | null;
  performed_by?: string | null;
  ref_type?: ProductStockRefType | null;
  ref_id?: string | Types.ObjectId | null;
}

export interface StockChange {
  product_id: unknown;
  qty_before: number;
  qty_after: number;
}

function toDoc(change: StockChange, type: ProductStockTxnType, ctx: StockLogContext = {}) {
  return {
    product_id: change.product_id,
    type,
    delta: change.qty_after - change.qty_before,
    qty_before: change.qty_before,
    qty_after: change.qty_after,
    note: ctx.note?.trim() ?? "",
    ref_type: ctx.ref_type ?? null,
    ref_id: ctx.ref_id ?? null,
    performed_by: ctx.performed_by ?? null,
  };
}

/** บันทึกหลายรายการ (ชนิดเดียวกัน context เดียวกัน) — เช่น ตัดสต็อกทั้งออเดอร์ */
export async function record(
  changes: StockChange[],
  type: ProductStockTxnType,
  ctx: StockLogContext = {}
): Promise<void> {
  if (changes.length === 0) return;
  try {
    await productStockTransactionModel.insertMany(changes.map((c) => toDoc(c, type, ctx)));
  } catch (err) {
    log.error("product_stock_history.record_failed", {
      type,
      product_ids: changes.map((c) => String(c.product_id)),
      err,
    });
  }
}

export interface ListStockHistoryQuery {
  pagination: Pagination;
  product_id?: string;
  type?: string;
  ref_type?: string;
  ref_id?: string;
  /** "YYYY-MM-DD" (วันตามเวลาไทย) หรือ ISO datetime */
  date_from?: string;
  date_to?: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string, endOfDay: boolean, field: string): Date {
  const d = DAY_RE.test(value)
    ? new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+07:00`)
    : new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} ไม่ใช่วันที่ที่ถูกต้อง`);
  return d;
}

/** เลขเอกสารต้นทาง (order_no / production_no) ต่อ ref_id — อ่านทีเดียวต่อชนิด */
async function refNumbers(items: any[]): Promise<Map<string, string>> {
  const idsOf = (t: ProductStockRefType) =>
    [...new Set(items.filter((i) => i.ref_type === t && i.ref_id).map((i) => String(i.ref_id)))];
  const orderIds = idsOf("order");
  const productionIds = idsOf("production_order");
  const [orders, productions] = await Promise.all([
    orderIds.length
      ? orderModel.find({ _id: { $in: orderIds } }).select("order_no").lean<any[]>()
      : [],
    productionIds.length
      ? productionOrderModel.find({ _id: { $in: productionIds } }).select("production_no").lean<any[]>()
      : [],
  ]);
  const byId = new Map<string, string>();
  for (const o of orders) byId.set(String(o._id), o.order_no);
  for (const p of productions) byId.set(String(p._id), p.production_no);
  return byId;
}

export async function listHistory(query: ListStockHistoryQuery) {
  await dbConnect();
  const filter: Record<string, any> = {};
  if (query.product_id) {
    assertObjectId(query.product_id, "product_id");
    filter.product_id = query.product_id;
  }
  if (query.type) {
    if (!PRODUCT_STOCK_TXN_TYPES.includes(query.type as ProductStockTxnType)) {
      throw badRequest(`type ต้องเป็นหนึ่งใน: ${PRODUCT_STOCK_TXN_TYPES.join(", ")}`);
    }
    filter.type = query.type;
  }
  if (query.ref_type) {
    if (!PRODUCT_STOCK_REF_TYPES.includes(query.ref_type as ProductStockRefType)) {
      throw badRequest(`ref_type ต้องเป็นหนึ่งใน: ${PRODUCT_STOCK_REF_TYPES.join(", ")}`);
    }
    filter.ref_type = query.ref_type;
  }
  if (query.ref_id) {
    assertObjectId(query.ref_id, "ref_id");
    filter.ref_id = query.ref_id;
  }
  if (query.date_from || query.date_to) {
    filter.created_at = {};
    if (query.date_from) filter.created_at.$gte = parseDate(query.date_from, false, "date_from");
    if (query.date_to) filter.created_at.$lte = parseDate(query.date_to, true, "date_to");
  }

  const [items, total] = await Promise.all([
    productStockTransactionModel
      .find(filter)
      .sort({ created_at: -1, _id: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate({
        path: "product_id",
        select: "product_id product_name_th unit_id",
        populate: { path: "unit_id", select: "unit_name unit_abbr" },
      })
      .populate("performed_by", "user_fullname email")
      .lean<any[]>(),
    productStockTransactionModel.countDocuments(filter),
  ]);

  const refNo = await refNumbers(items);
  return {
    items: items.map((i) => ({ ...i, ref_no: i.ref_id ? (refNo.get(String(i.ref_id)) ?? null) : null })),
    meta: buildMeta(total, query.pagination),
  };
}
