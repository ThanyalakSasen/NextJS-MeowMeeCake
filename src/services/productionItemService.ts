/**
 * productionItemService — รายการที่ต้องผลิตในใบสั่งผลิต (ProductionItems)
 *
 * แต่ละรายการ = ผลิตสินค้า 1 ตัว ตามสูตร (recipe) จำนวน planned_qty แบทช์ย่อย
 * consumeStock(): หักสต็อกวัตถุดิบตามสูตร (คูณตามจำนวนที่ผลิต) — บันทึกผ่าน ingredientTransactionService
 *   เพื่อให้ ledger วัตถุดิบตรงกับ current_stock; กันหักซ้ำด้วย stock_updated_at
 * reverseStock(): คืนสต็อกที่หักไป (สร้างรายการ receive ชดเชย)
 *
 * ⚠️ ไม่แปลงหน่วย — สมมติหน่วยในสูตรตรงกับหน่วยสต็อกวัตถุดิบ (ดู src/lib/bom.ts)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import productionItemModel from "../models/productionItemModel";
import productionOrderModel from "../models/productionOrderModel";
import productModel from "../models/productModel";
import recipeModel from "../models/recipeModel";
import componentModel from "../models/componentModel";
import ingredientModel from "../models/ingredientModel";
import * as ingredientTxnService from "./ingredientTransactionService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ITEM_STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface AddItemInput {
  product_id: string;
  recipe_id: string;
  planned_qty: number;
  round_item_id?: string | null;
  notes?: string | null;
}

// ── helper: รวมความต้องการวัตถุดิบของสูตร (ต่อ 1 แบทช์) โดยกาง component 1 ชั้น ──
async function ingredientDemandPerBatch(recipe: any): Promise<Map<string, { qty: number; unit_id: any }>> {
  const demand = new Map<string, { qty: number; unit_id: any }>();

  const add = (ingredientId: any, qty: number, unitId: any) => {
    const key = String(ingredientId);
    const cur = demand.get(key);
    if (cur) cur.qty += qty;
    else demand.set(key, { qty, unit_id: unitId });
  };

  for (const it of recipe.ingredients ?? []) {
    add(it.ingredient_id, Number(it.quantity || 0), it.unit_id);
  }

  const compRefs = recipe.components ?? [];
  if (compRefs.length) {
    const comps = await componentModel
      .find({ _id: { $in: compRefs.map((c: any) => c.component_id) } })
      .lean<any[]>();
    const byId = new Map(comps.map((c) => [String(c._id), c]));
    for (const cRef of compRefs) {
      const comp = byId.get(String(cRef.component_id));
      if (!comp || !comp.yield_qty) continue;
      const factor = Number(cRef.quantity || 0) / comp.yield_qty; // กี่ "แบทช์ component" ต่อ 1 แบทช์สูตร
      for (const ci of comp.ingredients ?? []) {
        add(ci.ingredient_id, Number(ci.quantity || 0) * factor, ci.unit_id);
      }
    }
  }

  return demand;
}

// ── CREATE ──────────────────────────────────────────────────
export async function addItem(orderId: string, input: AddItemInput) {
  await dbConnect();
  assertObjectId(orderId, "production_order_id");

  const order = await productionOrderModel
    .findOne({ _id: orderId, deleted_at: null })
    .lean<any>();
  if (!order) throw notFound("ไม่พบใบสั่งผลิตที่ระบุ");
  if (!["planned", "in_progress"].includes(order.production_status)) {
    throw conflict("เพิ่มรายการได้เฉพาะใบสั่งผลิตที่ยัง planned หรือ in_progress");
  }

  if (!input.product_id || !input.recipe_id) throw badRequest("ต้องระบุ product_id และ recipe_id");
  if (input.planned_qty == null || Number(input.planned_qty) <= 0) {
    throw badRequest("planned_qty ต้องมากกว่า 0");
  }
  await assertRefExists(productModel, input.product_id, "สินค้า", "product_id");

  assertObjectId(input.recipe_id, "recipe_id");
  const recipe = await recipeModel
    .findOne({ _id: input.recipe_id, deleted_at: null })
    .lean<any>();
  if (!recipe) throw notFound("ไม่พบสูตรการผลิตที่ระบุ");
  if (String(recipe.product_id) !== String(input.product_id)) {
    throw badRequest("สูตรที่เลือกไม่ตรงกับสินค้าที่จะผลิต");
  }

  const doc = await productionItemModel.create({
    production_order_id: orderId,
    product_id: input.product_id,
    recipe_id: input.recipe_id,
    round_item_id: input.round_item_id ?? null,
    planned_qty: Number(input.planned_qty),
    notes: input.notes ?? null,
  });
  return doc.toObject();
}

export async function listByOrder(orderId: string) {
  await dbConnect();
  assertObjectId(orderId, "production_order_id");
  return productionItemModel
    .find({ production_order_id: orderId, deleted_at: null })
    .populate("product_id", "product_name_th product_name_eng")
    .populate("recipe_id", "recipe_name yield_qty")
    .sort({ created_at: 1 })
    .lean();
}

export async function getItemById(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await productionItemModel
    .findOne({ _id: id, deleted_at: null })
    .populate("product_id", "product_name_th product_name_eng")
    .populate("recipe_id", "recipe_name yield_qty")
    .lean();
  if (!doc) throw notFound("ไม่พบรายการผลิตที่ระบุ");
  return doc;
}

export async function updateItem(id: string, input: Record<string, any>) {
  await dbConnect();
  assertObjectId(id);

  const item = await productionItemModel.findOne({ _id: id, deleted_at: null });
  if (!item) throw notFound("ไม่พบรายการผลิตที่ระบุ");

  if (input.item_status !== undefined && !ITEM_STATUSES.includes(input.item_status)) {
    throw badRequest(`item_status ต้องเป็นหนึ่งใน: ${ITEM_STATUSES.join(", ")}`);
  }
  for (const f of ["planned_qty", "actual_qty"] as const) {
    if (input[f] != null && Number(input[f]) < 0) throw badRequest(`${f} ต้องไม่ติดลบ`);
  }

  for (const f of ["planned_qty", "actual_qty", "notes", "item_status"] as const) {
    if (input[f] !== undefined) (item as any)[f] = input[f];
  }
  await item.save();
  return item.toObject();
}

// ── หักสต็อกวัตถุดิบตามสูตร ─────────────────────────────────
export async function consumeStock(
  id: string,
  opts: { performed_by: string; use_actual?: boolean; allowNegative?: boolean }
) {
  await dbConnect();
  assertObjectId(id);
  if (!opts.performed_by) throw badRequest("ต้องระบุ performed_by");

  const item = await productionItemModel.findOne({ _id: id, deleted_at: null });
  if (!item) throw notFound("ไม่พบรายการผลิตที่ระบุ");
  if (item.item_status === "cancelled") throw conflict("รายการนี้ถูกยกเลิกแล้ว");
  if (item.stock_updated_at) throw conflict("รายการนี้หักสต็อกวัตถุดิบไปแล้ว");

  const recipe = await recipeModel.findById(item.recipe_id).lean<any>();
  if (!recipe) throw notFound("ไม่พบสูตรการผลิตของรายการนี้");
  if (!recipe.yield_qty) throw badRequest("สูตรนี้ yield_qty เป็น 0 คำนวณการหักสต็อกไม่ได้");

  const qty = opts.use_actual && item.actual_qty != null ? item.actual_qty : item.planned_qty;
  const scale = Number(qty) / recipe.yield_qty;

  const demand = await ingredientDemandPerBatch(recipe);
  const lines = [...demand.entries()].map(([ingredient_id, v]) => ({
    ingredient_id,
    qty_consumed: Math.round(v.qty * scale * 1000) / 1000,
    unit_id: v.unit_id,
  }));

  // pre-flight: เช็คสต็อกพอทุกตัวก่อน (ยกเว้นสั่ง allowNegative)
  if (!opts.allowNegative && lines.length) {
    const rows = await ingredientModel
      .find({ _id: { $in: lines.map((l) => l.ingredient_id) } })
      .select("ingredient_name current_stock")
      .lean<any[]>();
    const stockById = new Map(rows.map((r) => [String(r._id), r]));
    const short = lines.filter(
      (l) => (stockById.get(l.ingredient_id)?.current_stock ?? 0) < l.qty_consumed
    );
    if (short.length) {
      throw conflict(
        "สต็อกวัตถุดิบไม่พอ: " +
          short
            .map(
              (l) =>
                `${stockById.get(l.ingredient_id)?.ingredient_name ?? l.ingredient_id} ` +
                `(มี ${stockById.get(l.ingredient_id)?.current_stock ?? 0}, ต้องใช้ ${l.qty_consumed})`
            )
            .join(", ")
      );
    }
  }

  const order = await productionOrderModel.findById(item.production_order_id).lean<any>();
  const ref = order?.production_no ?? String(item.production_order_id);

  const applied: typeof lines = [];
  try {
    for (const l of lines) {
      await ingredientTxnService.createTransaction({
        ingredient_id: l.ingredient_id,
        type: "use",
        qty: l.qty_consumed,
        unit_id: String(l.unit_id),
        performed_by: opts.performed_by,
        note: `ผลิต ${ref}`,
        allowNegative: !!opts.allowNegative,
        production_item_id: String(item._id),
      });
      applied.push(l);
    }
  } catch (err) {
    // ชดเชย: คืนสต็อกที่หักไปแล้ว
    for (const l of applied) {
      await ingredientTxnService
        .createTransaction({
          ingredient_id: l.ingredient_id,
          type: "receive",
          qty: l.qty_consumed,
          unit_id: String(l.unit_id),
          performed_by: opts.performed_by,
          note: `ยกเลิกการหักสต็อก (ผลิต ${ref})`,
          production_item_id: String(item._id),
        })
        .catch(() => undefined);
    }
    throw err;
  }

  item.stock_impact = lines as any;
  item.stock_updated_at = new Date();
  if (item.actual_qty == null) item.actual_qty = qty;
  item.item_status = "done";
  await item.save();
  return item.toObject();
}

// ── คืนสต็อกที่หักไป ────────────────────────────────────────
export async function reverseStock(id: string, opts: { performed_by: string }) {
  await dbConnect();
  assertObjectId(id);
  if (!opts.performed_by) throw badRequest("ต้องระบุ performed_by");

  const item = await productionItemModel.findOne({ _id: id, deleted_at: null });
  if (!item) throw notFound("ไม่พบรายการผลิตที่ระบุ");
  if (!item.stock_updated_at || !(item.stock_impact?.length)) {
    throw badRequest("รายการนี้ยังไม่ได้หักสต็อก จึงไม่มีอะไรให้คืน");
  }

  const order = await productionOrderModel.findById(item.production_order_id).lean<any>();
  const ref = order?.production_no ?? String(item.production_order_id);

  for (const l of item.stock_impact as any[]) {
    await ingredientTxnService.createTransaction({
      ingredient_id: String(l.ingredient_id),
      type: "receive",
      qty: l.qty_consumed,
      unit_id: String(l.unit_id),
      performed_by: opts.performed_by,
      note: `คืนสต็อกจากการยกเลิกผลิต ${ref}`,
      production_item_id: String(item._id),
    });
  }

  item.stock_impact = [] as any;
  item.stock_updated_at = null;
  if (item.item_status === "done") item.item_status = "in_progress";
  await item.save();
  return item.toObject();
}

// ── DELETE (soft) — เฉพาะรายการที่ยังไม่หักสต็อก ────────────
export async function deleteItem(id: string) {
  await dbConnect();
  assertObjectId(id);
  const item = await productionItemModel.findOne({ _id: id, deleted_at: null });
  if (!item) throw notFound("ไม่พบรายการผลิตที่ระบุ");
  if (item.stock_updated_at) {
    throw conflict("รายการนี้หักสต็อกไปแล้ว ให้ทำ reverse-stock ก่อนจึงจะลบได้");
  }
  item.deleted_at = new Date();
  await item.save();
  return { deleted: true, _id: item._id };
}
