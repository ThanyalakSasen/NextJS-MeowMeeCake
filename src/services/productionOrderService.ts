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
 *                        + เพิ่มสต็อกสินค้าสำเร็จรูปของสินค้าปกติ (BACKLOG4 Y2)
 *                        + สร้างล็อตสินค้า (วันผลิต/วันหมดอายุ · บาร์โค้ด — productLotService)
 *  - cancelProduction  : → cancelled, คืนสต็อกของรายการที่หักไปแล้ว
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { Saga } from "../lib/compensation";
import { generateDocNo, isPreorderProduct } from "../lib/productCode";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import productionOrderModel from "../models/productionOrderModel";
import productionItemModel from "../models/productionItemModel";
import userModel from "../models/userModel";
import preorderRoundModel from "../models/preorderRoundModel";
import preorderModel from "../models/preorderModel";
import preorderItemModel from "../models/preorderItemModel";
import recipeModel from "../models/recipeModel";
import productModel from "../models/productModel";
import * as productionItemService from "./productionItemService";
import * as productService from "./productService";
import * as productLotService from "./productLotService";
import type { AddItemInput } from "./productionItemService";
import type { LotDateInput } from "./productLotService";

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
  assertNoteLength(input.production_note);
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
 * รวมยอดสั่งต่อสินค้าของรอบ — เฉพาะพรีออเดอร์ที่ยังไม่ถูกลบ/ยกเลิก · paid=true นับเฉพาะ "ยืนยันการชำระเงินแล้ว"
 * paid=false นับเฉพาะที่ยังไม่จ่าย (ให้ preview บอกว่ามีอะไรไม่ถูกนับ) · ใช้ร่วมกันระหว่างสร้างจริงกับ preview
 * docs/preorder-round-flow.md ประเด็น 3 (ตัดสินใจ 2026-10-01) — เดิมนับทุกรายการรวมที่ยังไม่จ่าย → ผลิตให้คนไม่จ่าย
 * รายการที่จ่ายทีหลัง (เช่น สลิปรอตรวจตอนปิดรอบ) บวกเข้าใบผลิตให้ที่ preorderRoundLifecycleService.onPreorderPaid
 */
async function roundDemand(
  roundId: unknown,
  paid: boolean
): Promise<Array<{ _id: unknown; round_item_id: unknown; qty: number; preorder_ids: unknown[] }>> {
  return preorderItemModel.aggregate([
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
        "preorder.round_id": roundId,
        "preorder.deleted_at": null,
        "preorder.order_status": { $ne: "cancelled" },
        "preorder.payment_status": paid ? "paid" : { $ne: "paid" },
      },
    },
    {
      $group: {
        _id: "$product_id",
        round_item_id: { $first: "$round_item_id" },
        qty: { $sum: "$quantity" },
        preorder_ids: { $addToSet: "$preorder_id" },
      },
    },
  ]);
}

/**
 * สูตรล่าสุดต่อสินค้า — เรียงใหม่→เก่า แล้วเอาตัวแรก คล้าย recipeService.getUnitCostByProduct() แต่เพิ่ม
 * _id เป็น tie-breaker ด้วย (created_at ละเอียดแค่ระดับมิลลิวินาที ถ้าสร้าง 2 สูตรในมิลลิวินาทีเดียวกัน
 * Mongo ไม่การันตีลำดับผลลัพธ์ที่ค่าเท่ากัน — ยืนยันจริงจากเทสที่เพิ่มใหม่ ObjectId มีตัวนับเพิ่มขึ้นเสมอ
 * ต่อการสร้างในโปรเซสเดียวกัน จึงเรียงได้ deterministic เสมอ) กันกรณีสินค้าหนึ่งมีสูตรที่ยังไม่ถูกลบ
 * มากกว่า 1 สูตร (เดิมไม่มี .sort() เลย ทำให้ผลลัพธ์ไม่แน่นอนขึ้นกับ Mongo ไม่ใช่เจตนา — docs/BACKLOG2.md §12.2)
 */
async function latestRecipeByProduct(productIds: string[]): Promise<Map<string, any>> {
  const recipes = await recipeModel
    .find({ product_id: { $in: productIds }, deleted_at: null })
    .sort({ created_at: -1, _id: -1 })
    .lean<any[]>();
  const recipeByProduct = new Map<string, any>();
  for (const r of recipes) {
    if (!recipeByProduct.has(String(r.product_id))) recipeByProduct.set(String(r.product_id), r);
  }
  return recipeByProduct;
}

export type FromRoundBlocker = "round_not_closed" | "already_has_production" | "no_paid_orders" | "missing_recipe";

/**
 * ดูล่วงหน้าก่อนสร้างใบสั่งผลิตจากรอบ — ใช้ roundDemand/latestRecipeByProduct ชุดเดียวกับ
 * createProductionFromRound ตัวเลขจึงตรงกับที่จะสร้างจริง · blockers = เหตุที่ createProductionFromRound
 * จะปฏิเสธ (ว่าง = สร้างได้) · unpaid = ยอดที่ยังไม่จ่าย จะไม่ถูกนับ (จ่ายทีหลังค่อยบวกเข้าใบเอง)
 */
export async function previewProductionFromRound(roundId: string) {
  await dbConnect();
  assertObjectId(roundId, "round_id");

  const round = await preorderRoundModel
    .findOne({ _id: roundId, deleted_at: null })
    .select("round_name pickup_date round_status")
    .lean<any>();
  if (!round) throw notFound("ไม่พบรอบพรีออเดอร์ที่ระบุ");

  const [existing, paid, unpaid] = await Promise.all([
    productionOrderModel
      .findOne({ round_id: round._id, deleted_at: null, production_status: { $ne: "cancelled" } })
      .select("production_no production_status")
      .lean<any>(),
    roundDemand(round._id, true),
    roundDemand(round._id, false),
  ]);

  const productIds = [...new Set([...paid, ...unpaid].map((g) => String(g._id)))];
  const [recipeByProduct, products] = await Promise.all([
    latestRecipeByProduct(productIds),
    productModel.find({ _id: { $in: productIds } }).select("product_name_th").lean<any[]>(),
  ]);
  const nameById = new Map(products.map((p) => [String(p._id), p.product_name_th as string]));
  const unpaidByProduct = new Map(unpaid.map((g) => [String(g._id), g.qty]));

  const lines = productIds
    .map((id) => {
      const recipe = recipeByProduct.get(id);
      return {
        product_id: id,
        product_name_th: nameById.get(id) ?? "-",
        planned_qty: paid.find((g) => String(g._id) === id)?.qty ?? 0,
        unpaid_qty: unpaidByProduct.get(id) ?? 0,
        recipe: recipe ? { _id: String(recipe._id), recipe_name: recipe.recipe_name as string } : null,
      };
    })
    .sort((a, b) => b.planned_qty - a.planned_qty || a.product_name_th.localeCompare(b.product_name_th, "th"));

  const blockers: FromRoundBlocker[] = [];
  if (round.round_status !== "closed") blockers.push("round_not_closed");
  if (existing) blockers.push("already_has_production");
  if (!paid.length) blockers.push("no_paid_orders");
  // สินค้าที่ยังไม่มีคนจ่าย ไม่เข้าใบผลิต — ไม่มีสูตรก็ไม่ขวาง
  if (lines.some((l) => l.planned_qty > 0 && !l.recipe)) blockers.push("missing_recipe");

  const count = (groups: { preorder_ids: unknown[] }[]) => new Set(groups.flatMap((g) => g.preorder_ids.map(String))).size;
  return {
    round: { _id: String(round._id), round_name: round.round_name, pickup_date: round.pickup_date, round_status: round.round_status },
    existing_production: existing
      ? { _id: String(existing._id), production_no: existing.production_no, production_status: existing.production_status }
      : null,
    products: lines,
    paid_order_count: count(paid),
    unpaid_order_count: count(unpaid),
    blockers,
  };
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
  assertNoteLength(input.production_note);

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

  const grouped = await roundDemand(round._id, true);
  if (!grouped.length) throw badRequest("รอบนี้ยังไม่มีพรีออเดอร์ที่ชำระเงินแล้ว (นับเฉพาะรายการที่ยืนยันการชำระเงิน)");

  const productIds = grouped.map((g) => String(g._id));
  const recipeByProduct = await latestRecipeByProduct(productIds);
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

  // แนบ items[] ให้ทุกใบ (query เดียว) — หน้าจัดการการผลิตใช้ข้อมูลจากรายการนี้ทั้ง drawer รายละเอียด
  // ฟอร์มปิดงาน (กรอกจำนวนที่ผลิตได้จริง) และสรุปประวัติการผลิต · เดิมมีเฉพาะ GET รายตัว
  const itemsByOrder = await productionItemService.listByOrders(items.map((o) => String(o._id)));
  return {
    items: items.map((o) => ({ ...o, items: itemsByOrder.get(String(o._id)) ?? [] })),
    meta: buildMeta(total, query.pagination),
  };
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
  assertNoteLength(input.production_note);
  for (const f of ["production_date", "assigned_to", "production_note"] as const) {
    if (input[f] !== undefined) {
      (order as any)[f] = f === "production_date" ? new Date(input[f]) : input[f];
    }
  }
  await order.save();
  return getProductionOrderById(id);
}

/** หมายเหตุใบสั่งผลิต — เดิมไม่จำกัดความยาว (หน้าเว็บตั้ง maxLength เท่ากัน) */
const MAX_NOTE_LENGTH = 1000;
function assertNoteLength(note: unknown): void {
  if (typeof note === "string" && note.length > MAX_NOTE_LENGTH) {
    throw badRequest(`production_note ยาวได้ไม่เกิน ${MAX_NOTE_LENGTH} ตัวอักษร`);
  }
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
 * actuals ของ completeProduction → Map(item_id → actual_qty) · ตรวจทั้งก้อนก่อนแตะข้อมูล
 * รายการที่หักวัตถุดิบไปแล้วตั้งเป็น 0 (ยกเลิก) ไม่ได้ — วัตถุดิบที่หักไปจะไม่ถูกคืน ต้อง reverse-stock ก่อน
 */
function parseActuals(items: any[], raw: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (raw == null) return out;
  if (!Array.isArray(raw)) throw badRequest("actuals ต้องเป็น array");
  const byId = new Map(items.map((it) => [String(it._id), it]));
  for (const a of raw as any[]) {
    const itemId = String(a?.item_id ?? "");
    const it = byId.get(itemId);
    if (!it) throw badRequest(`actuals: ไม่พบรายการผลิต ${itemId} ในใบสั่งผลิตนี้`);
    const qty = Number(a?.actual_qty);
    if (a?.actual_qty == null || !Number.isInteger(qty) || qty < 0) throw badRequest("actual_qty ต้องเป็นจำนวนเต็มไม่ติดลบ");
    if (qty === 0 && it.stock_updated_at) {
      throw conflict("รายการที่หักวัตถุดิบไปแล้วตั้งจำนวนผลิตได้เป็น 0 ไม่ได้ — คืนวัตถุดิบ (reverse-stock) ก่อน");
    }
    out.set(itemId, qty);
  }
  return out;
}

/**
 * ปิดงานผลิต: in_progress → done
 * รายการที่ยังไม่ถูกหักสต็อก (stock_updated_at = null) และไม่ถูกยกเลิก จะถูกหักสต็อกให้ตอนนี้
 *
 * ทำให้ "สำเร็จทั้งใบ หรือไม่เปลี่ยนอะไรเลย" (เดิมพลาดกลางทางแล้วค้างครึ่ง ๆ):
 *   1. ตรวจทุกอย่างก่อนแตะข้อมูล — วันที่ล็อต · actuals · วัตถุดิบพอ "รวมทั้งใบ" (ไม่ใช่ทีละรายการ)
 *   2. บันทึก actuals + หักวัตถุดิบ — ล้มกลางทาง = คืนวัตถุดิบ/ค่าเดิมของรายการที่ทำไปรอบนี้ ใบยัง in_progress
 *   3. เพิ่มสต็อกสินค้า + สร้างล็อต แล้วจึงตั้ง done เป็นขั้นสุดท้าย — สองขั้นนี้ทำซ้ำได้ (ครั้งเดียวต่อรายการ)
 *      ล้มตรงนี้ใบยัง in_progress กดปิดงานอีกครั้งจะทำต่อจากที่ค้าง (เดิมใบ done ไปแล้ว ไม่มีสต็อก/ล็อต และกดซ้ำไม่ได้)
 */
export async function completeProduction(
  id: string,
  opts: {
    performed_by: string;
    use_actual?: boolean;
    allowNegative?: boolean;
    /** วันผลิต/วันหมดอายุจริงต่อรายการ (ไม่ส่ง = ค่าเริ่มต้นจากใบสั่งผลิต + อายุสินค้า) */
    lots?: LotDateInput[];
    /** จำนวนที่ผลิตได้จริงต่อรายการ [{ item_id, actual_qty }] — 0 = ยกเลิกรายการ (ไม่หักวัตถุดิบ/ไม่เพิ่มสต็อก)
     *  เดิมหน้าเว็บ PATCH ทีละรายการก่อนเรียกปิดงาน → ปิดงานพลาดแล้วรายการถูกยกเลิกค้างไว้ */
    actuals?: unknown;
  }
) {
  await dbConnect();
  assertObjectId(id);
  if (!opts.performed_by) throw badRequest("ต้องระบุ performed_by");

  const order = await transition(id, "done");
  // ── 1. ตรวจ ──
  const lotInputs = await productLotService.validateLotInputs(String(order._id), opts.lots);
  const items = await productionItemModel.find({ production_order_id: order._id, deleted_at: null }).lean<any[]>();
  const actuals = parseActuals(items, opts.actuals);

  const actualOf = (it: any) => (actuals.has(String(it._id)) ? actuals.get(String(it._id))! : it.actual_qty);
  const pending = items.filter(
    (it) => !it.stock_updated_at && it.item_status !== "cancelled" && actuals.get(String(it._id)) !== 0
  );
  const consumeQty = (it: any) => (opts.use_actual && actualOf(it) != null ? Number(actualOf(it)) : Number(it.planned_qty));

  if (pending.length) {
    const check = await productionItemService.checkIngredientStock(
      pending.map((it) => ({ recipe_id: String(it.recipe_id), planned_qty: consumeQty(it) }))
    );
    if (check.items.some((r) => r.recipe_invalid)) {
      throw badRequest("มีรายการที่ไม่พบสูตรการผลิต หรือสูตรมี yield_qty เป็น 0 — คำนวณการหักวัตถุดิบไม่ได้");
    }
    if (!opts.allowNegative && check.total_shortages.length) {
      throw conflict(
        "สต็อกวัตถุดิบไม่พอ: " +
          check.total_shortages.map((s) => `${s.ingredient_name} (มี ${s.in_stock}, ต้องใช้ ${s.required})`).join(", ")
      );
    }
  }

  // ── 2. บันทึก actuals + หักวัตถุดิบ (ล้ม = ย้อนกลับเฉพาะที่ทำรอบนี้) ──
  const touched = items.filter((it) => actuals.has(String(it._id)) || pending.includes(it));
  const consumed: string[] = [];
  try {
    for (const [itemId, qty] of actuals) {
      await productionItemModel.updateOne(
        { _id: itemId },
        { $set: qty > 0 ? { actual_qty: qty } : { actual_qty: 0, item_status: "cancelled" } }
      );
    }
    for (const it of pending) {
      await productionItemService.consumeStock(String(it._id), {
        performed_by: opts.performed_by,
        use_actual: opts.use_actual,
        allowNegative: opts.allowNegative,
      });
      consumed.push(String(it._id));
    }
  } catch (err) {
    for (const itemId of consumed) {
      await productionItemService.reverseStock(itemId, { performed_by: opts.performed_by }).catch(() => undefined);
    }
    for (const it of touched) {
      await productionItemModel
        .updateOne({ _id: it._id }, { $set: { actual_qty: it.actual_qty ?? null, item_status: it.item_status } })
        .catch(() => undefined);
    }
    throw err;
  }

  // ── 3. สต็อกสินค้า + ล็อต แล้วค่อยปิดใบ ──
  // docs/BACKLOG4.md Y2 — เดิมผลิตเสร็จแล้วหักแค่วัตถุดิบ ไม่เพิ่มสต็อกสินค้า ต้องไปปรับสต็อกเองทุกครั้ง
  await addFinishedGoodsStock(String(order._id), { use_actual: opts.use_actual, performed_by: opts.performed_by });
  await productLotService.createLotsForProduction(order, { use_actual: opts.use_actual, lots: lotInputs });

  order.production_status = "done";
  order.completed_at = new Date();
  await order.save();
  return getProductionOrderById(id);
}

/**
 * ปิดงานผลิตแล้ว → เพิ่มสต็อกสินค้าสำเร็จรูป (docs/BACKLOG4.md Y2 — ตัดสินใจ 2026-10-01: เพิ่มอัตโนมัติ)
 *   - เฉพาะสินค้าปกติ (is_preorder: false) — พรีออเดอร์ไม่มีสต็อก ของส่งตรงให้ลูกค้าที่สั่ง
 *   - จำนวน = actual_qty ถ้าส่ง use_actual และกรอกไว้ ไม่งั้น planned_qty (เดียวกับที่ใช้หักวัตถุดิบ)
 *   - ข้ามรายการที่ยกเลิก / จำนวน 0 · ครั้งเดียวต่อรายการ (จอง product_stock_added_at แบบ atomic)
 *   - เพิ่มผ่าน productService.increaseStock (atomic $inc เดียวกับการรับสินค้าเข้าสต็อก) · ประวัติสต็อก type "production"
 *   - สินค้าที่มีตัวเลือกก็เพิ่มที่ตัวสินค้า — ตัวเลือกเป็นแค่ราคาเพิ่ม ไม่มีสต็อกแยก (docs/customer-backend-merge.md §8)
 */
async function addFinishedGoodsStock(
  orderId: string,
  opts: { use_actual?: boolean; performed_by?: string } = {}
): Promise<void> {
  const items = await productionItemModel
    .find({
      production_order_id: orderId,
      deleted_at: null,
      item_status: { $ne: "cancelled" },
      product_stock_added_at: null,
    })
    .lean<any[]>();
  if (items.length === 0) return;

  const products = await productModel
    .find({ _id: { $in: items.map((i) => i.product_id) } })
    .select("is_preorder")
    .lean<Array<{ _id: unknown; is_preorder?: boolean }>>();
  const preorderIds = new Set(products.filter((p) => isPreorderProduct(p)).map((p) => String(p._id)));

  for (const it of items) {
    if (preorderIds.has(String(it.product_id))) continue;
    const qty = opts.use_actual && it.actual_qty != null ? Number(it.actual_qty) : Number(it.planned_qty);
    if (!(qty > 0)) continue;

    const claimed = await productionItemModel.findOneAndUpdate(
      { _id: it._id, product_stock_added_at: null },
      { $set: { product_stock_added_at: new Date(), product_stock_added_qty: qty } }
    );
    if (!claimed) continue;
    await productService.increaseStock(String(it.product_id), qty, {
      type: "production",
      ref_type: "production_order",
      ref_id: orderId,
      performed_by: opts.performed_by ?? null,
    });
  }
}

/**
 * ยกเลิกงานผลิต → cancelled
 * รายการที่หักสต็อกไปแล้วจะถูกคืนสต็อก (สร้างรายการ receive ชดเชย)
 * ใบที่ปิดงานค้างครึ่งทาง (เพิ่มสต็อกสินค้า/สร้างล็อตแล้วแต่ยังไม่ done) → ตัดสต็อกสินค้าที่เพิ่มคืน + ลบล็อต
 * (เดิมคืนแค่วัตถุดิบ สินค้าที่ไม่ได้ผลิตจริงค้างอยู่ในสต็อกและล็อต)
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

  const creditedItems = await productionItemModel
    .find({ production_order_id: order._id, product_stock_added_at: { $ne: null } })
    .lean<any[]>();
  for (const it of creditedItems) {
    const released = await productionItemModel.findOneAndUpdate(
      { _id: it._id, product_stock_added_at: { $ne: null } },
      { $set: { product_stock_added_at: null, product_stock_added_qty: null } }
    );
    const qty = Number(released?.product_stock_added_qty ?? 0);
    if (!(qty > 0)) continue;
    // สินค้าอาจขายไปบางส่วนแล้ว — ยอมติดลบให้เห็นในสต็อก ดีกว่าค้างยอดที่ไม่มีของจริง
    await productService.decreaseStock(String(it.product_id), qty, {
      allowNegative: true,
      log: {
        type: "adjust",
        ref_type: "production_order",
        ref_id: String(order._id),
        performed_by: opts.performed_by ?? null,
        note: "ยกเลิกใบสั่งผลิต — ตัดสต็อกสินค้าที่เพิ่มตอนปิดงานคืน",
      },
    });
  }
  await productLotService.removeLotsForProduction(order._id);

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
