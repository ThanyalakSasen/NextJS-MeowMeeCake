/**
 * bom — ตัวช่วยเรื่องสูตร/ส่วนประกอบ (Bill of Materials) ใช้ร่วมกันระหว่าง recipeService และ componentService
 *
 * ⚠️ การคิดต้นทุนที่นี่ "ไม่แปลงหน่วย" — สมมติว่า quantity ในสูตรอยู่หน่วยเดียวกับ cost_per_unit
 * ของวัตถุดิบ ถ้าต้องรองรับการแปลงหน่วย (กรัม↔กิโล ฯลฯ) ต้องต่อยอดจากตารางอัตราแปลงหน่วยภายหลัง
 *
 * BACKLOG §3.11 เฟส 4 — ไม่ต้องแก้ไฟล์นี้เลยแม้ ingredientModel.cost_per_unit/componentModel.
 * estimated_cost_per_batch จะเปลี่ยนหน่วยเป็นสตางค์: ฟังก์ชันตรงนี้แค่ "คูณ/หาร" ตัวเลขที่ query
 * มาจาก DB ตรง ๆ ไม่เคยแปลงหน่วยเอง ผลลัพธ์จึงเป็นหน่วยเดียวกับ input เสมอ (satang เข้า → satang ออก)
 * ผู้เรียก (componentService.prepare/recipeService.prepare) เป็นคนปัดเศษให้เป็น integer สตางค์เอง
 */
import type { Model } from "mongoose";
import { badRequest } from "./httpError";
import { assertObjectId } from "./objectId";
import { assertRefExists } from "./refs";

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

/** shape ดิบก่อนตรวจ — ยังไม่รู้ว่าครบ/ถูกต้องหรือเปล่า (นั่นคือหน้าที่ของ validateItems เอง) */
type RawItem = Record<string, unknown>;

async function validateItems(
  items: RawItem[],
  idField: "ingredient_id" | "component_id",
  refModel: Model<unknown>,
  label: string,
  unitModel: Model<unknown>
): Promise<void> {
  if (!Array.isArray(items)) throw badRequest(`${idField.replace("_id", "")} ต้องเป็น array`);
  for (const [i, it] of items.entries()) {
    const id = it?.[idField];
    if (!it || !id) throw badRequest(`รายการที่ ${i + 1}: ต้องระบุ ${idField}`);
    assertObjectId(String(id), `${idField}[${i}]`);
    if (it.quantity == null || Number(it.quantity) < 0) {
      throw badRequest(`รายการที่ ${i + 1}: quantity ต้องไม่ติดลบ`);
    }
    if (!it.unit_id) throw badRequest(`รายการที่ ${i + 1}: ต้องระบุ unit_id`);
    assertObjectId(String(it.unit_id), `unit_id[${i}]`);
    await assertRefExists(refModel, String(id), label, idField);
    await assertRefExists(unitModel, String(it.unit_id), "หน่วยนับ", "unit_id");
  }
}

export async function validateIngredientItems(
  items: RawItem[],
  ingredientModel: Model<unknown>,
  unitModel: Model<unknown>
): Promise<void> {
  await validateItems(items ?? [], "ingredient_id", ingredientModel, "วัตถุดิบ", unitModel);
}

export async function validateComponentItems(
  items: RawItem[],
  componentModel: Model<unknown>,
  unitModel: Model<unknown>
): Promise<void> {
  await validateItems(items ?? [], "component_id", componentModel, "ส่วนประกอบ", unitModel);
}

/** ผลรวม quantity * cost_per_unit ของวัตถุดิบทุกตัวในสูตร */
export async function ingredientItemsCost(
  items: IngredientItem[],
  ingredientModel: Model<unknown>
): Promise<number> {
  if (!items?.length) return 0;
  const ids = items.map((it) => it.ingredient_id);
  const rows = await ingredientModel
    .find({ _id: { $in: ids } })
    .select("cost_per_unit")
    .lean<{ _id: unknown; cost_per_unit?: number }[]>();
  const costById = new Map(rows.map((r) => [String(r._id), r.cost_per_unit ?? 0]));
  return items.reduce(
    (sum, it) => sum + Number(it.quantity || 0) * (costById.get(String(it.ingredient_id)) ?? 0),
    0
  );
}

/** ผลรวมต้นทุนของ component items = quantity * (ต้นทุนต่อหน่วยผลผลิตของ component) */
export async function componentItemsCost(
  items: ComponentItem[],
  componentModel: Model<unknown>
): Promise<number> {
  if (!items?.length) return 0;
  const ids = items.map((it) => it.component_id);
  const rows = await componentModel
    .find({ _id: { $in: ids } })
    .select("estimated_cost_per_batch yield_qty")
    .lean<{ _id: unknown; estimated_cost_per_batch?: number; yield_qty?: number }[]>();
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
