/**
 * productionOrderService — ใบสั่งผลิต (ProductionOrders) + รายการผลิต (ผ่าน productionItemService)
 *
 * สร้างได้ 2 ทาง:
 *  - createProductionOrder    : สร้างเอง (source_type บังคับเป็น "manual" เสมอ ไม่ผูก round_id)
 *  - createProductionFromRound: สร้างจากรอบพรีออเดอร์ที่ "ปิดรับแล้ว" (source_type = "preorder",
 *    round_id ผูกไว้) — รวมยอดสั่งจริงต่อสินค้าจากพรีออเดอร์ที่ยังไม่ยกเลิกในรอบนั้นให้อัตโนมัติ
 *    สร้างได้แค่ 1 ใบต่อรอบ (ยกเลิกใบเดิมก่อนถ้าต้องการสร้างใหม่)
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
import { Saga } from "../lib/compensation";
import { generateDocNo } from "../lib/productCode";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import productionOrderModel from "../models/productionOrderModel";
import productionItemModel from "../models/productionItemModel";
import userModel from "../models/userModel";
import preorderRoundModel from "../models/preorderRoundModel";
import preorderModel from "../models/preorderModel";
import preorderItemModel from "../models/preorderItemModel";
import recipeModel from "../models/recipeModel";
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
  round_id?: string;
  assigned_to?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  includeDeleted?: boolean;
}

export interface CreateProductionFromRoundInput {
  round_id: string;
  production_date: string | Date;
  assigned_to?: string | null;
  production_note?: string | null;
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
        production_no: generateDocNo("PRD", 5),
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
    // BACKLOG2 §2.2 — เดิมวน await addItem() ทีละรายการ (แต่ละครั้ง fetch order ซ้ำ + query
    // product/recipe แยก) เปลี่ยนมา addItems() (พหูพจน์) แบบ batch ครั้งเดียว
    //
    // BACKLOG2 §10 — ไล่เทียบกับ orderService.persistOrder()/preorderService.createPreorder() (ทั้งคู่
    // ห่อขั้น "สร้าง header แล้วค่อยสร้าง child items" ด้วย Saga) พบว่าที่นี่ไม่มี — ถ้า addItems()
    // throw (เช่น recipe_id ที่ระบุไม่ตรงกับ product_id ของรายการนั้น เป็น validation ที่เกิด*หลัง*
    // สร้าง header ไปแล้ว ต่างจาก preorderRoundService.createRound() ที่ validate items ให้ครบ*ก่อน*
    // สร้าง header) จะเหลือใบสั่งผลิต "planned" ที่ไม่มีรายการค้างอยู่ใน DB ตลอดไป ไม่มีทาง rollback —
    // ใช้ Saga แบบเดียวกับ order/preorder ปิดช่องนี้
    const saga = new Saga();
    saga.onRollback("delete-production-order", () =>
      productionOrderModel.deleteOne({ _id: order._id })
    );
    try {
      await productionItemService.addItems(String(order._id), input.items);
      saga.commit();
    } catch (err) {
      await saga.rollback();
      throw err;
    }
  }

  return getProductionOrderById(String(order._id));
}

/**
 * สร้างใบสั่งผลิตจาก "รอบพรีออเดอร์" ที่ปิดรับแล้ว — รวมยอดสั่งจริงต่อสินค้าจากพรีออเดอร์ที่ยังไม่
 * ยกเลิกทั้งหมดในรอบนั้น (join preorderItems → preorders ด้วย round_id) แล้วสร้างเป็น production
 * item 1 แถวต่อสินค้า (planned_qty = ผลรวมจำนวนที่ลูกค้าสั่ง) ผูก round_item_id ไว้ด้วยเพื่อย้อนดูที่มา
 *
 * บังคับ round_status = "closed" เท่านั้น (ยอดสั่งยังไม่นิ่งตอน scheduled/open) และให้สร้างได้แค่ 1 ใบ
 * ต่อรอบ (กันสร้างซ้ำ/สับสนว่าใบไหนคือของจริง) — ยกเลิกใบเดิมได้ถ้าต้องการสร้างใหม่
 */
export async function createProductionFromRound(input: CreateProductionFromRoundInput) {
  await dbConnect();
  assertObjectId(input.round_id, "round_id");
  if (!input.production_date) throw badRequest("กรุณาระบุ production_date");

  const round = await preorderRoundModel.findOne({ _id: input.round_id, deleted_at: null }).lean<any>();
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ระบุ");
  if (round.round_status !== "closed") {
    throw conflict('สร้างใบสั่งผลิตได้เฉพาะรอบที่สถานะ "ปิดรับแล้ว" เท่านั้น (ยอดสั่งของรอบที่ยังไม่ปิดยังไม่นิ่ง)');
  }

  const existing = await productionOrderModel.countDocuments({
    round_id: round._id,
    deleted_at: null,
    production_status: { $ne: "cancelled" },
  });
  if (existing > 0) throw conflict("มีใบสั่งผลิตสำหรับรอบนี้อยู่แล้ว (ยกเลิกใบเดิมก่อนถ้าต้องการสร้างใหม่)");

  if (input.assigned_to) {
    await assertRefExists(userModel, input.assigned_to, "ผู้รับผิดชอบ", "assigned_to");
  }

  // รวมยอดสั่งจริงต่อสินค้า — เฉพาะพรีออเดอร์ที่ยังไม่ถูกลบ/ยกเลิกในรอบนี้เท่านั้น
  const grouped = await preorderItemModel.aggregate([
    {
      $lookup: {
        from: preorderModel.collection.name,
        localField: "preorder_id",
        foreignField: "_id",
        as: "preorder",
      },
    },
    { $unwind: "$preorder" },
    {
      $match: {
        "preorder.round_id": round._id,
        "preorder.deleted_at": null,
        "preorder.order_status": { $ne: "cancelled" },
      },
    },
    {
      $group: {
        _id: "$product_id",
        round_item_id: { $first: "$round_item_id" },
        qty: { $sum: "$quantity" },
      },
    },
  ]);
  if (!grouped.length) throw badRequest("รอบนี้ยังไม่มีพรีออเดอร์ที่ต้องผลิต (ไม่นับรายการที่ยกเลิกแล้ว)");

  const productIds = grouped.map((g) => String(g._id));
  // เรียงใหม่→เก่า แล้วเอาตัวแรก (ล่าสุด) ต่อสินค้า — คล้าย recipeService.getUnitCostByProduct() แต่เพิ่ม
  // _id เป็น tie-breaker ด้วย (created_at ละเอียดแค่ระดับมิลลิวินาที ถ้าสร้าง 2 สูตรในมิลลิวินาทีเดียวกัน
  // Mongo ไม่การันตีลำดับผลลัพธ์ที่ค่าเท่ากัน — ยืนยันจริงจากเทสที่เพิ่มใหม่ ObjectId มีตัวนับเพิ่มขึ้นเสมอ
  // ต่อการสร้างในโปรเซสเดียวกัน จึงเรียงได้ deterministic เสมอ) กันกรณีสินค้าหนึ่งมีสูตรที่ยังไม่ถูกลบ
  // มากกว่า 1 สูตร (เดิมไม่มี .sort() เลย ทำให้ผลลัพธ์ไม่แน่นอนขึ้นกับ Mongo ไม่ใช่เจตนา — docs/BACKLOG2.md §12.2)
  const recipes = await recipeModel
    .find({ product_id: { $in: productIds }, deleted_at: null })
    .sort({ created_at: -1, _id: -1 })
    .lean<any[]>();
  const recipeByProduct = new Map<string, any>();
  for (const r of recipes) {
    if (!recipeByProduct.has(String(r.product_id))) recipeByProduct.set(String(r.product_id), r);
  }
  const missing = productIds.filter((id) => !recipeByProduct.has(id));
  if (missing.length) {
    throw badRequest(`มีสินค้า ${missing.length} รายการในรอบนี้ที่ยังไม่มีสูตรผูกไว้ — ผูกสูตรให้ครบก่อนสร้างใบสั่งผลิต`);
  }

  let order: any = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    try {
      order = await productionOrderModel.create({
        production_no: generateDocNo("PRD", 5),
        production_date: new Date(input.production_date),
        source_type: "preorder",
        round_id: round._id,
        production_status: "planned",
        assigned_to: input.assigned_to ?? null,
        production_note: input.production_note ?? null,
      });
    } catch (err: any) {
      if (err?.code === 11000 && attempt < 4) continue;
      throw err;
    }
  }

  const saga = new Saga();
  saga.onRollback("delete-production-order", () => productionOrderModel.deleteOne({ _id: order._id }));
  try {
    const inputs: AddItemInput[] = grouped.map((g) => ({
      product_id: String(g._id),
      recipe_id: String(recipeByProduct.get(String(g._id))._id),
      planned_qty: g.qty,
      round_item_id: g.round_item_id ? String(g.round_item_id) : null,
    }));
    await productionItemService.addItems(String(order._id), inputs);
    saga.commit();
  } catch (err) {
    await saga.rollback();
    throw err;
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
  if (query.round_id) {
    assertObjectId(query.round_id, "round_id");
    filter.round_id = query.round_id;
  }
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
      .populate("round_id", "round_name pickup_date round_status")
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
    .populate("round_id", "round_name pickup_date round_status")
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
