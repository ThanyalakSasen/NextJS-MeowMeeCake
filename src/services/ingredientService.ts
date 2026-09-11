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
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { createCrudService } from "../lib/crudService";
import ingredientModel from "../models/ingredientModel";
import ingredientCategoryModel from "../models/ingredientCategoryModel";
import unitModel from "../models/unitModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
});

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

export const ingredientService = {
  ...base,

  async create(input: Record<string, any>) {
    if (!input.ingredient_name) throw badRequest("กรุณาระบุ ingredient_name");
    if (!input.ingredient_category_id) throw badRequest("กรุณาระบุ ingredient_category_id");
    if (!input.unit_id) throw badRequest("กรุณาระบุ unit_id");
    if (input.cost_per_unit == null) throw badRequest("กรุณาระบุ cost_per_unit");
    if (input.reorder_point == null) throw badRequest("กรุณาระบุ reorder_point");
    await assertRefs(input);
    return base.create(input);
  },

  async update(id: string, input: Record<string, any>) {
    await assertRefs(input);
    return base.update(id, input);
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

    return { count: items.length, items };
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
