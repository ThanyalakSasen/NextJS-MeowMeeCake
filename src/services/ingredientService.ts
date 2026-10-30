/**
 * ingredientService — วัตถุดิบ (Ingredients)
 *
 * - CRUD ข้อมูลวัตถุดิบ (ชื่อ unique, ผูกหมวดหมู่ + หน่วยนับ)
 * - current_stock เป็นยอดคงเหลือแบบ denormalized — **ห้ามแก้ตรง ๆ** ให้เปลี่ยนผ่าน
 *   ingredientTransactionService.createTransaction() (รับเข้า/เบิกใช้/ปรับยอด) เท่านั้น
 * - getLowStock(): วัตถุดิบที่ยอดคงเหลือถึงจุดสั่งซื้อ (reorder_point)
 */
import type { Model } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { createCrudService } from "../lib/crudService";
import ingredientModel from "../models/ingredientModel";
import ingredientCategoryModel from "../models/ingredientCategoryModel";
import unitModel from "../models/unitModel";
import recipeModel from "../models/recipeModel";
import componentModel from "../models/componentModel";
import { toSatang, toBahtFields } from "../lib/money";

/* eslint-disable @typescript-eslint/no-explicit-any */

// cost_per_unit — เงินเก็บเป็นบาท ทศนิยม 2 ตำแหน่ง (docs/money-units.md) · presenter แค่ปัดก่อนคืน
function presentIngredient<T extends Record<string, unknown>>(doc: T): T {
  return toBahtFields(doc, ["cost_per_unit"] as const);
}

const base = createCrudService(ingredientModel as Model<any>, {
  label: "วัตถุดิบ",
  searchFields: ["ingredient_name", "supplier"],
  // current_stock ตั้งได้แค่ตอนสร้าง (ยอดยกมา) หลังจากนั้นต้องผ่าน transaction
  createFields: [
    "ingredient_name",
    "ingredient_category_id",
    "unit_id",
    "current_stock",
    "cost_per_unit",
    "reorder_point",
    "max_stock",
    "supplier",
  ],
  updateFields: [
    "ingredient_name",
    "ingredient_category_id",
    "unit_id",
    "cost_per_unit",
    "reorder_point",
    "max_stock",
    "supplier",
  ],
  populate: [
    { path: "ingredient_category_id", select: "ingredient_category_name" },
    { path: "unit_id", select: "unit_name unit_abbr" },
  ],
  present: presentIngredient, // BACKLOG3 §8 — ครอบ list/getById/create/update/remove/restore ให้เองในตัว
});

/** เปลี่ยนหน่วยของวัตถุดิบ = ตัวเลขเดิมถูกตีความเป็นหน่วยใหม่ (ไม่มีการแปลงหน่วย) — เช่นสต็อก 500 g กลายเป็น 500 kg
 *  และสูตรที่ใช้ "500" ตามหน่วยเดิมจะหักสต็อกผิด · ยอมให้เปลี่ยนเฉพาะตอนสต็อกเป็น 0 และยังไม่มีสูตร/ส่วนประกอบใช้ */
async function assertUnitChangeAllowed(id: string, unitId: string): Promise<void> {
  assertObjectId(id);
  await dbConnect();
  const cur = await ingredientModel.findOne({ _id: id, deleted_at: null }).select("unit_id current_stock").lean<any>();
  if (!cur || String(cur.unit_id) === unitId) return;
  if ((cur.current_stock ?? 0) !== 0) {
    throw conflict("เปลี่ยนหน่วยไม่ได้ เพราะวัตถุดิบยังมียอดคงเหลือ (ยอดเดิมจะถูกนับเป็นหน่วยใหม่) — ปรับยอดเป็น 0 ก่อน");
  }
  const match = { "ingredients.ingredient_id": cur._id, deleted_at: null };
  if ((await recipeModel.exists(match).lean()) || (await componentModel.exists(match).lean())) {
    throw conflict("เปลี่ยนหน่วยไม่ได้ เพราะมีสูตร/ส่วนประกอบใช้วัตถุดิบนี้อยู่ (ปริมาณในสูตรคิดตามหน่วยเดิม)");
  }
}

/** วัตถุดิบที่ยังมียอดคงเหลือลบไม่ได้ — ต้องใช้หมดหรือปรับยอดเป็น 0 ก่อน (ผู้ใช้ขอ 2026-10-30) */
async function assertNoStock(id: string): Promise<void> {
  assertObjectId(id);
  await dbConnect();
  const ing = await ingredientModel
    .findById(id)
    .select("current_stock unit_id")
    .populate("unit_id", "unit_abbr")
    .lean<{ current_stock?: number; unit_id?: { unit_abbr?: string } | null } | null>();
  const qty = Number(ing?.current_stock ?? 0);
  if (qty > 0) {
    const unit = ing?.unit_id?.unit_abbr ? ` ${ing.unit_id.unit_abbr}` : "";
    throw conflict(`วัตถุดิบนี้ยังมียอดคงเหลือ ${qty.toLocaleString("th-TH")}${unit} ลบยังไม่ได้ — ใช้ให้หมดหรือปรับยอดเป็น 0 ก่อน`);
  }
}

/** ลบวัตถุดิบที่สูตร/ส่วนประกอบยังใช้อยู่ไม่ได้ — เดิมลบได้ แล้วปิดงานผลิตของสูตรนั้นล้มทุกใบด้วย "ไม่พบวัตถุดิบที่ระบุ"
 *  (เจอจริง 2026-10-30: ลบ "เนยจืด" ที่ 14 สูตรใช้) · ต้องเอาออกจากสูตรก่อน */
async function assertNotUsed(id: string): Promise<void> {
  assertObjectId(id);
  await dbConnect();
  const match = { "ingredients.ingredient_id": id, deleted_at: null };
  const [recipes, components] = await Promise.all([
    recipeModel.find(match).select("recipe_name").sort({ recipe_name: 1 }).limit(21).lean<Array<{ recipe_name?: string }>>(),
    componentModel.find(match).select("component_name").sort({ component_name: 1 }).limit(21).lean<Array<{ component_name?: string }>>(),
  ]);
  const names = [...recipes.map((r) => r.recipe_name), ...components.map((c) => c.component_name)].filter(Boolean);
  if (names.length === 0) return;
  // หน้าจอแสดงข้อความนี้ตรง ๆ (เตือน "ยังมีสูตรที่ใช้วัตถุดิบนี้อยู่ ลบยังไม่ได้") — บอกชื่อสูตรให้ไปแก้ได้ทันที
  const shown = names.slice(0, 20).join(", ") + (names.length > 20 ? " และอื่น ๆ" : "");
  throw conflict(`ยังมีสูตรที่ใช้วัตถุดิบนี้อยู่ (${shown}) — เอาวัตถุดิบออกจากสูตรเหล่านี้ก่อนจึงลบได้`);
}

async function assertRefs(input: Record<string, any>): Promise<void> {
  if (input.ingredient_category_id) {
    await assertRefExists(
      ingredientCategoryModel,
      input.ingredient_category_id,
      "หมวดหมู่วัตถุดิบ",
      "ingredient_category_id"
    );
  }
  if (input.unit_id) {
    await assertRefExists(unitModel, input.unit_id, "หน่วยนับ", "unit_id");
  }
  for (const f of ["cost_per_unit", "reorder_point", "current_stock", "max_stock"] as const) {
    if (input[f] != null && Number(input[f]) < 0) {
      throw badRequest(`${f} ต้องไม่ติดลบ`);
    }
  }
}

// BACKLOG3 §8 — list/getById/remove/restore ไม่ต้อง override เองแล้ว เหลือแค่ create/update ที่ยังต้อง
// override เพราะมี validation เพิ่มเติม + ปัด cost_per_unit (บาท 2 ตำแหน่ง) ก่อนเขียน
export const ingredientService = {
  ...base,

  async create(input: Record<string, any>) {
    if (!input.ingredient_name) throw badRequest("กรุณาระบุ ingredient_name");
    if (!input.ingredient_category_id) throw badRequest("กรุณาระบุ ingredient_category_id");
    if (!input.unit_id) throw badRequest("กรุณาระบุ unit_id");
    if (input.cost_per_unit == null) throw badRequest("กรุณาระบุ cost_per_unit");
    if (input.reorder_point == null) throw badRequest("กรุณาระบุ reorder_point");
    await assertRefs(input);
    const payload = { ...input, cost_per_unit: toSatang(Number(input.cost_per_unit)) };
    return base.create(payload);
  },

  async update(id: string, input: Record<string, any>) {
    await assertRefs(input);
    if (input.unit_id) await assertUnitChangeAllowed(id, String(input.unit_id));
    const payload =
      input.cost_per_unit != null
        ? { ...input, cost_per_unit: toSatang(Number(input.cost_per_unit)) }
        : input;
    return base.update(id, payload);
  },

  async remove(id: string) {
    await assertNoStock(id);
    await assertNotUsed(id);
    return base.remove(id);
  },

  /** วัตถุดิบที่ current_stock <= reorder_point (เรียงจากขาดหนักสุด) */
  async getLowStock(opts: { limit?: number } = {}) {
    await dbConnect();
    const limit = Math.min(200, Math.max(1, Number(opts.limit) || 100));

    const items = await ingredientModel
      .find({
        deleted_at: null,
        $expr: { $lte: ["$current_stock", "$reorder_point"] },
      })
      .sort({ current_stock: 1 })
      .limit(limit)
      .populate("ingredient_category_id", "ingredient_category_name")
      .populate("unit_id", "unit_name unit_abbr")
      .lean();

    return { count: items.length, items: items.map(presentIngredient) };
  },

  /** อ่านยอดคงเหลือปัจจุบัน */
  async getStock(id: string): Promise<number> {
    await dbConnect();
    assertObjectId(id);
    const ing = await ingredientModel
      .findOne({ _id: id, deleted_at: null })
      .select("current_stock")
      .lean<any>();
    if (!ing) throw notFound("ไม่พบวัตถุดิบที่ระบุ");
    return ing.current_stock ?? 0;
  },
};

export default ingredientService;
