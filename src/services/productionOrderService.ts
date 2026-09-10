/**
 * productionOrderService — ใบสั่งผลิต (ProductionOrders) + รายการผลิต (ผ่าน productionItemService)
 *
 * เฟสนี้รองรับ source_type = "manual" เท่านั้น
 * ("preorder" — สร้างใบสั่งผลิตจากรอบพรีออเดอร์ — เป็นงานเฟส 5)
 *
 * flow: planned → in_progress → done   (ยกเลิกได้ทุกสถานะที่ยังไม่ done → cancelled)
 *  - startProduction   : planned → in_progress, เซ็ต started_at
 *  - completeProduction: in_progress → done, หักสต็อกวัตถุดิบของรายการที่ยังไม่ถูกหักให้ครบ
 *  - cancelProduction  : → cancelled, คืนสต็อกของรายการที่หักไปแล้ว
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import productionOrderModel from "../models/productionOrderModel";
import productionItemModel from "../models/productionItemModel";
import userModel from "../models/userModel";
import * as productionItemService from "./productionItemService";
import type { AddItemInput } from "./productionItemService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PRODUCTION_STATUSES = ["planned", "in_progress", "done", "cancelled"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

const NEXT_STATUS: Record<ProductionStatus, ProductionStatus[]> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export interface CreateProductionOrderInput {
  production_date: string | Date;
  source_type?: "manual";
  assigned_to?: string | null;
  production_note?: string | null;
  items?: AddItemInput[];
}

export interface ListProductionOrderQuery {
  pagination: Pagination;
  production_status?: ProductionStatus;
  source_type?: "manual" | "preorder";
  assigned_to?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  includeDeleted?: boolean;
}

// ── helper ─────────────────────────────────────────────────
function randomProductionNo(now = new Date()): string {
  const ymd =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `PRD-${ymd}-${rand}`;
}

// ── CREATE ─────────────────────────────────────────────────
export async function createProductionOrder(input: CreateProductionOrderInput) {
  await dbConnect();

  if (!input.production_date) throw badRequest("กรุณาระบุ production_date");
  if (input.source_type && input.source_type !== "manual") {
    throw badRequest('เฟสนี้รองรับ source_type = "manual" เท่านั้น (preorder อยู่ในเฟสถัดไป)');
  }
  if (input.assigned_to) {
    await assertRefExists(userModel, input.assigned_to, "ผู้รับผิดชอบ", "assigned_to");
  }

  let order: any = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    try {
      order = await productionOrderModel.create({
        production_no: randomProductionNo(),
        production_date: new Date(input.production_date),
        source_type: "manual",
        production_status: "planned",
        assigned_to: input.assigned_to ?? null,
        production_note: input.production_note ?? null,
      });
    } catch (err: any) {
      if (err?.code === 11000 && attempt < 4) continue;
      throw err;
    }
  }

  if (Array.isArray(input.items) && input.items.length) {
    for (const raw of input.items) {
      await productionItemService.addItem(String(order._id), raw);
    }
  }

  return getProductionOrderById(String(order._id));
}

// ── READ ───────────────────────────────────────────────────
export async function listProductionOrders(query: ListProductionOrderQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  if (query.production_status) filter.production_status = query.production_status;
  if (query.source_type) filter.source_type = query.source_type;
  if (query.assigned_to) {
    assertObjectId(query.assigned_to, "assigned_to");
    filter.assigned_to = query.assigned_to;
  }
  if (query.search) filter.production_no = new RegExp(escapeRegExp(query.search.trim()), "i");
  if (query.date_from || query.date_to) {
    filter.production_date = {};
    if (query.date_from) filter.production_date.$gte = new Date(query.date_from);
    if (query.date_to) filter.production_date.$lte = new Date(query.date_to);
  }

  const [items, total] = await Promise.all([
    productionOrderModel
      .find(filter)
      .sort({ production_date: -1, created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("assigned_to", "user_fullname email")
      .lean(),
    productionOrderModel.countDocuments(filter),
  ]);

  return { items, meta: buildMeta(total, query.pagination) };
}

export async function getProductionOrderById(id: string, opts: { includeDeleted?: boolean } = {}) {
  await dbConnect();
  assertObjectId(id);

  const filter: Record<string, any> = { _id: id };
  if (!opts.includeDeleted) filter.deleted_at = null;

  const order = await productionOrderModel
    .findOne(filter)
    .populate("assigned_to", "user_fullname email")
    .lean<any>();
  if (!order) throw notFound("ไม่พบใบสั่งผลิตที่ระบุ");

  const items = await productionItemService.listByOrder(String(order._id));
  return { ...order, items };
}

// ── UPDATE (ข้อมูลหัวใบ) ───────────────────────────────────
export async function updateProductionOrder(id: string, input: Record<string, any>) {
  await dbConnect();
  assertObjectId(id);

  const order = await productionOrderModel.findOne({ _id: id, deleted_at: null });
  if (!order) throw notFound("ไม่พบใบสั่งผลิตที่ระบุ");
  if (["done", "cancelled"].includes(order.production_status)) {
    throw conflict("ใบสั่งผลิตที่ปิดแล้วแก้ไขไม่ได้");
  }

  if (input.assigned_to) {
    await assertRefExists(userModel, input.assigned_to, "ผู้รับผิดชอบ", "assigned_to");
  }
  for (const f of ["production_date", "assigned_to", "production_note"] as const) {
    if (input[f] !== undefined) {
      (order as any)[f] = f === "production_date" ? new Date(input[f]) : input[f];
    }
  }
  await order.save();
  return getProductionOrderById(id);
}

// ── STATUS ─────────────────────────────────────────────────
async function transition(id: string, next: ProductionStatus): Promise<any> {
  const order = await productionOrderModel.findOne({ _id: id, deleted_at: null });
  if (!order) throw notFound("ไม่พบใบสั่งผลิตที่ระบุ");
  const current = order.production_status as ProductionStatus;
  if (!NEXT_STATUS[current].includes(next)) {
    throw conflict(`เปลี่ยนสถานะจาก "${current}" เป็น "${next}" ไม่ได้`);
  }
  return order;
}

export async function startProduction(id: string) {
  await dbConnect();
  assertObjectId(id);
  const order = await transition(id, "in_progress");
  order.production_status = "in_progress";
  if (!order.started_at) order.started_at = new Date();
  await order.save();
  return getProductionOrderById(id);
}

/**
 * ปิดงานผลิต: in_progress → done
 * รายการที่ยังไม่ถูกหักสต็อก (stock_updated_at = null) และไม่ถูกยกเลิก จะถูกหักสต็อกให้ตอนนี้
 */
export async function completeProduction(
  id: string,
  opts: { performed_by: string; use_actual?: boolean; allowNegative?: boolean }
) {
  await dbConnect();
  assertObjectId(id);
  if (!opts.performed_by) throw badRequest("ต้องระบุ performed_by");

  const order = await transition(id, "done");

  const pendingItems = await productionItemModel
    .find({
      production_order_id: order._id,
      deleted_at: null,
      stock_updated_at: null,
      item_status: { $ne: "cancelled" },
    })
    .lean<any[]>();

  for (const it of pendingItems) {
    await productionItemService.consumeStock(String(it._id), {
      performed_by: opts.performed_by,
      use_actual: opts.use_actual,
      allowNegative: opts.allowNegative,
    });
  }

  order.production_status = "done";
  order.completed_at = new Date();
  await order.save();
  return getProductionOrderById(id);
}

/**
 * ยกเลิกงานผลิต → cancelled
 * รายการที่หักสต็อกไปแล้วจะถูกคืนสต็อก (สร้างรายการ receive ชดเชย)
 */
export async function cancelProduction(
  id: string,
  opts: { performed_by?: string; reason?: string } = {}
) {
  await dbConnect();
  assertObjectId(id);

  const order = await transition(id, "cancelled");

  const consumedItems = await productionItemModel
    .find({
      production_order_id: order._id,
      deleted_at: null,
      stock_updated_at: { $ne: null },
    })
    .lean<any[]>();

  if (consumedItems.length && !opts.performed_by) {
    throw badRequest("มีรายการที่หักสต็อกไปแล้ว ต้องระบุ performed_by เพื่อคืนสต็อก");
  }
  for (const it of consumedItems) {
    await productionItemService.reverseStock(String(it._id), {
      performed_by: opts.performed_by as string,
    });
  }

  await productionItemModel.updateMany(
    { production_order_id: order._id, deleted_at: null, item_status: { $ne: "cancelled" } },
    { $set: { item_status: "cancelled" } }
  );

  order.production_status = "cancelled";
  if (opts.reason) order.production_note = `${order.production_note ?? ""} [ยกเลิก: ${opts.reason}]`.trim();
  await order.save();
  return getProductionOrderById(id);
}

// ── DELETE (soft) ─────────────────────────────────────────
export async function deleteProductionOrder(id: string) {
  await dbConnect();
  assertObjectId(id);
  const order = await productionOrderModel.findOne({ _id: id, deleted_at: null });
  if (!order) throw notFound("ไม่พบใบสั่งผลิตที่ระบุ หรือถูกลบไปแล้ว");
  if (!["done", "cancelled"].includes(order.production_status)) {
    throw conflict("ลบได้เฉพาะใบสั่งผลิตที่เสร็จหรือยกเลิกแล้ว");
  }
  order.deleted_at = new Date();
  await order.save();
  await productionItemModel.updateMany(
    { production_order_id: order._id, deleted_at: null },
    { $set: { deleted_at: new Date() } }
  );
  return { deleted: true, _id: order._id };
}
