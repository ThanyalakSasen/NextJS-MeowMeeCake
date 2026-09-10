/**
 * bom — ตัวช่วยเรื่องสูตร/ส่วนประกอบ (Bill of Materials) ใช้ร่วมกันระหว่าง recipeService และ componentService
 *
 * ⚠️ การคิดต้นทุนที่นี่ "ไม่แปลงหน่วย" — สมมติว่า quantity ในสูตรอยู่หน่วยเดียวกับ cost_per_unit
 * ของวัตถุดิบ ถ้าต้องรองรับการแปลงหน่วย (กรัม↔กิโล ฯลฯ) ต้องต่อยอดจากตารางอัตราแปลงหน่วยภายหลัง
 */
import type { Model } from "mongoose";
import { badRequest } from "./httpError";
import { assertObjectId } from "./objectId";
import { assertRefExists } from "./refs";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IngredientItem {
  ingredient_id: string;
  quantity: number;
  unit_id: string;
}
export interface ComponentItem {
  component_id: string;
  quantity: number;
  unit_id: string;
}

async function validateItems(
  items: any[],
  idField: "ingredient_id" | "component_id",
  refModel: Model<any>,
  label: string,
  unitModel: Model<any>
): Promise<void> {
  if (!Array.isArray(items)) throw badRequest(`${idField.replace("_id", "")} ต้องเป็น array`);
  for (const [i, it] of items.entries()) {
    if (!it || !it[idField]) throw badRequest(`รายการที่ ${i + 1}: ต้องระบุ ${idField}`);
    assertObjectId(it[idField], `${idField}[${i}]`);
    if (it.quantity == null || Number(it.quantity) < 0) {
      throw badRequest(`รายการที่ ${i + 1}: quantity ต้องไม่ติดลบ`);
    }
    if (!it.unit_id) throw badRequest(`รายการที่ ${i + 1}: ต้องระบุ unit_id`);
    assertObjectId(it.unit_id, `unit_id[${i}]`);
    await assertRefExists(refModel, it[idField], label, idField);
    await assertRefExists(unitModel, it.unit_id, "หน่วยนับ", "unit_id");
  }
}

export async function validateIngredientItems(
  items: any[],
  ingredientModel: Model<any>,
  unitModel: Model<any>
): Promise<void> {
  await validateItems(items ?? [], "ingredient_id", ingredientModel, "วัตถุดิบ", unitModel);
}

export async function validateComponentItems(
  items: any[],
  componentModel: Model<any>,
  unitModel: Model<any>
): Promise<void> {
  await validateItems(items ?? [], "component_id", componentModel, "ส่วนประกอบ", unitModel);
}

/** ผลรวม quantity * cost_per_unit ของวัตถุดิบทุกตัวในสูตร */
export async function ingredientItemsCost(
  items: any[],
  ingredientModel: Model<any>
): Promise<number> {
  if (!items?.length) return 0;
  const ids = items.map((it) => it.ingredient_id);
  const rows = await ingredientModel
    .find({ _id: { $in: ids } })
    .select("cost_per_unit")
    .lean<any[]>();
  const costById = new Map(rows.map((r) => [String(r._id), r.cost_per_unit ?? 0]));
  return items.reduce(
    (sum, it) => sum + Number(it.quantity || 0) * (costById.get(String(it.ingredient_id)) ?? 0),
    0
  );
}

/** ผลรวมต้นทุนของ component items = quantity * (ต้นทุนต่อหน่วยผลผลิตของ component) */
export async function componentItemsCost(
  items: any[],
  componentModel: Model<any>
): Promise<number> {
  if (!items?.length) return 0;
  const ids = items.map((it) => it.component_id);
  const rows = await componentModel
    .find({ _id: { $in: ids } })
    .select("estimated_cost_per_batch yield_qty")
    .lean<any[]>();
  const perUnitById = new Map(
    rows.map((r) => [
      String(r._id),
      r.yield_qty ? (r.estimated_cost_per_batch ?? 0) / r.yield_qty : 0,
    ])
  );
  return items.reduce(
    (sum, it) => sum + Number(it.quantity || 0) * (perUnitById.get(String(it.component_id)) ?? 0),
    0
  );
}
