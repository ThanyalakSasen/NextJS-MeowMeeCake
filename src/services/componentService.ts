/**
 * componentService — ส่วนประกอบ/กึ่งสำเร็จรูป (Components) เช่น ครีม, ไส้, แป้งฐาน
 *
 * โครงคล้าย recipe แต่ผูกกับ "หมวดหมู่ส่วนประกอบ" แทนสินค้า และมีเฉพาะวัตถุดิบ (ไม่มี components ซ้อน)
 * estimated_cost_per_batch คิดอัตโนมัติจากต้นทุนวัตถุดิบถ้าไม่ได้ส่งมา
 *
 * NOTE: componentModel.componentcategory_id ระบุ ref "ComponentCategories" (พหูพจน์) แต่ model จริง
 * ชื่อ "ComponentCategory" — จึง populate ด้วยการส่ง model ตรง ๆ
 */
import type { Model } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { createCrudService } from "../lib/crudService";
import { validateIngredientItems, ingredientItemsCost } from "../lib/bom";
import componentModel from "../models/componentModel";
import componentCategoryModel from "../models/componentsCategory";
import ingredientModel from "../models/ingredientModel";
import unitModel from "../models/unitModel";
import userModel from "../models/userModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WRITABLE = [
  "component_name",
  "componentcategory_id",
  "yield_qty",
  "yield_unit_id",
  "estimated_cost_per_batch",
  "steps_content",
  "note",
  "ingredients",
] as const;

const base = createCrudService(componentModel as Model<any>, {
  label: "ส่วนประกอบ",
  searchFields: ["component_name"],
  createFields: WRITABLE,
  updateFields: [
    "component_name",
    "yield_qty",
    "yield_unit_id",
    "estimated_cost_per_batch",
    "steps_content",
    "note",
    "ingredients",
  ],
  populate: [{ path: "yield_unit_id", select: "unit_name unit_abbr" }],
});

async function prepare(input: Record<string, any>, isCreate: boolean): Promise<void> {
  if (input.componentcategory_id) {
    await assertRefExists(
      componentCategoryModel,
      input.componentcategory_id,
      "หมวดหมู่ส่วนประกอบ",
      "componentcategory_id"
    );
  }
  if (input.yield_unit_id) {
    await assertRefExists(unitModel, input.yield_unit_id, "หน่วยผลผลิต", "yield_unit_id");
  }
  if (input.yield_qty != null && Number(input.yield_qty) < 0) {
    throw badRequest("yield_qty ต้องไม่ติดลบ");
  }
  if (input.ingredients !== undefined) {
    await validateIngredientItems(input.ingredients, ingredientModel as Model<any>, unitModel as Model<any>);
  }

  if ((isCreate || input.ingredients !== undefined) && input.estimated_cost_per_batch == null) {
    const cost = await ingredientItemsCost(input.ingredients ?? [], ingredientModel as Model<any>);
    input.estimated_cost_per_batch = Math.round(cost * 100) / 100;
  }
}

function pickWritable(input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of WRITABLE) if (input[k] !== undefined) out[k] = input[k];
  return out;
}

export const componentService = {
  ...base,

  async create(input: Record<string, any>) {
    for (const f of ["component_name", "componentcategory_id", "yield_qty", "yield_unit_id", "created_by"] as const) {
      if (input[f] == null || input[f] === "") throw badRequest(`กรุณาระบุ ${f}`);
    }
    await assertRefExists(userModel, input.created_by, "ผู้สร้าง", "created_by");
    await prepare(input, true);
    const doc = await componentModel.create({
      ...pickWritable(input),
      created_by: input.created_by,
    });
    return doc.toObject();
  },

  async update(id: string, input: Record<string, any>) {
    await prepare(input, false);
    return base.update(id, input);
  },

  async getExpanded(id: string) {
    await dbConnect();
    assertObjectId(id);
    const doc = await componentModel
      .findOne({ _id: id, deleted_at: null })
      .populate({
        path: "componentcategory_id",
        select: "component_category_name",
        model: componentCategoryModel as Model<any>,
      })
      .populate("yield_unit_id", "unit_name unit_abbr")
      .populate("ingredients.ingredient_id", "ingredient_name cost_per_unit current_stock")
      .populate("ingredients.unit_id", "unit_name unit_abbr")
      .lean();
    if (!doc) throw notFound("ไม่พบส่วนประกอบที่ระบุ");
    return doc;
  },

  async listByCategory(categoryId: string) {
    await dbConnect();
    assertObjectId(categoryId, "componentcategory_id");
    return componentModel
      .find({ componentcategory_id: categoryId, deleted_at: null })
      .populate("yield_unit_id", "unit_name unit_abbr")
      .sort({ created_at: -1 })
      .lean();
  },
};

export default componentService;
