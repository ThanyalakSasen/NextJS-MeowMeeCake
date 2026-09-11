/**
 * recipeService — สูตรการผลิตสินค้า (Recipes)
 *
 * สูตรผูกกับสินค้า 1 ตัว ระบุวัตถุดิบ + ส่วนประกอบ (components) ที่ใช้ต่อ 1 แบทช์ (yield_qty)
 * estimated_cost_per_batch คำนวณให้อัตโนมัติจากต้นทุนวัตถุดิบ + ส่วนประกอบ ถ้าไม่ได้ส่งมาเอง
 * (ดูข้อจำกัดเรื่องหน่วยใน src/lib/bom.ts)
 */
import type { Model } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { assertObjectId, isObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { createCrudService } from "../lib/crudService";
import {
  validateIngredientItems,
  validateComponentItems,
  ingredientItemsCost,
  componentItemsCost,
} from "../lib/bom";
import recipeModel from "../models/recipeModel";
import productModel from "../models/productModel";
import ingredientModel from "../models/ingredientModel";
import componentModel from "../models/componentModel";
import unitModel from "../models/unitModel";
import userModel from "../models/userModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WRITABLE = [
  "recipe_name",
  "product_id",
  "yield_qty",
  "yield_unit_id",
  "estimated_cost_per_batch",
  "duration_minutes",
  "steps_content",
  "note",
  "ingredients",
  "components",
] as const;

const base = createCrudService(recipeModel as Model<any>, {
  label: "สูตรการผลิต",
  searchFields: ["recipe_name"],
  createFields: WRITABLE,
  updateFields: [
    "recipe_name",
    "yield_qty",
    "yield_unit_id",
    "estimated_cost_per_batch",
    "duration_minutes",
    "steps_content",
    "note",
    "ingredients",
    "components",
  ],
  populate: [
    { path: "product_id", select: "product_name_th product_name_eng" },
    { path: "yield_unit_id", select: "unit_name unit_abbr" },
  ],
});

async function prepare(input: Record<string, any>, isCreate: boolean): Promise<void> {
  if (input.yield_unit_id) {
    await assertRefExists(unitModel, input.yield_unit_id, "หน่วยผลผลิต", "yield_unit_id");
  }
  if (input.yield_qty != null && Number(input.yield_qty) < 0) {
    throw badRequest("yield_qty ต้องไม่ติดลบ");
  }

  if (input.ingredients !== undefined) {
    await validateIngredientItems(input.ingredients, ingredientModel as Model<any>, unitModel as Model<any>);
  }
  if (input.components !== undefined) {
    await validateComponentItems(input.components, componentModel as Model<any>, unitModel as Model<any>);
  }

  // คิดต้นทุน/แบทช์ อัตโนมัติเมื่อไม่ได้ส่งมา และมีข้อมูลรายการพอจะคิด
  const hasItemsInfo = input.ingredients !== undefined || input.components !== undefined;
  if ((isCreate || hasItemsInfo) && input.estimated_cost_per_batch == null) {
    const ingCost = await ingredientItemsCost(input.ingredients ?? [], ingredientModel as Model<any>);
    const compCost = await componentItemsCost(input.components ?? [], componentModel as Model<any>);
    input.estimated_cost_per_batch = Math.round((ingCost + compCost) * 100) / 100;
  }
}

export const recipeService = {
  ...base,

  async create(input: Record<string, any>) {
    for (const f of ["recipe_name", "product_id", "yield_qty", "yield_unit_id", "created_by"] as const) {
      if (input[f] == null || input[f] === "") throw badRequest(`กรุณาระบุ ${f}`);
    }
    await assertRefExists(productModel, input.product_id, "สินค้า", "product_id");
    await assertRefExists(userModel, input.created_by, "ผู้สร้าง", "created_by");
    await prepare(input, true);
    // created_by ไม่ได้อยู่ใน WRITABLE (กัน mass-assign ที่ layer อื่น) — ใส่ตรงนี้เอง
    const doc = await recipeModel.create({ ...pickWritable(input), created_by: input.created_by });
    return doc.toObject();
  },

  async update(id: string, input: Record<string, any>) {
    await prepare(input, false);
    return base.update(id, input);
  },

  /** สูตรทั้งหมดของสินค้าตัวหนึ่ง */
  async listByProduct(productId: string) {
    await dbConnect();
    assertObjectId(productId, "product_id");
    return recipeModel
      .find({ product_id: productId, deleted_at: null })
      .populate("yield_unit_id", "unit_name unit_abbr")
      .sort({ created_at: -1 })
      .lean();
  },

  /** ดึงสูตรพร้อม populate วัตถุดิบ/ส่วนประกอบแบบเต็ม (ใช้ตอนวางแผนผลิต) */
  async getExpanded(id: string) {
    await dbConnect();
    assertObjectId(id);
    const recipe = await recipeModel
      .findOne({ _id: id, deleted_at: null })
      .populate("product_id", "product_name_th product_name_eng")
      .populate("yield_unit_id", "unit_name unit_abbr")
      .populate("ingredients.ingredient_id", "ingredient_name cost_per_unit current_stock")
      .populate("ingredients.unit_id", "unit_name unit_abbr")
      .populate("components.component_id", "component_name estimated_cost_per_batch yield_qty")
      .populate("components.unit_id", "unit_name unit_abbr")
      .lean();
    if (!recipe) throw notFound("ไม่พบสูตรการผลิตที่ระบุ");
    return recipe;
  },
};

function pickWritable(input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of WRITABLE) if (input[k] !== undefined) out[k] = input[k];
  return out;
}

/**
 * ต้นทุนต่อหน่วยของสินค้า = estimated_cost_per_batch / yield_qty ของ "สูตรล่าสุด" ของสินค้านั้น
 * ใช้ตอนสร้างออเดอร์เพื่อ snapshot cost_per_unit ลง orderItem (คำนวณกำไรใน dashboard)
 * คืน Map<productId, number | null> — null = ไม่มีสูตร / yield_qty เป็น 0
 */
export async function getUnitCostByProduct(
  productIds: string[]
): Promise<Map<string, number | null>> {
  await dbConnect();

  const out = new Map<string, number | null>();
  for (const id of productIds) out.set(String(id), null);

  const validIds = [...new Set(productIds.map(String))].filter(isObjectId);
  if (validIds.length === 0) return out;

  // สูตรทั้งหมดของสินค้าเหล่านี้ เรียงใหม่→เก่า แล้วเอาตัวแรก (ล่าสุด) ต่อสินค้า
  const recipes = await recipeModel
    .find({ product_id: { $in: validIds }, deleted_at: null })
    .select("product_id estimated_cost_per_batch yield_qty")
    .sort({ created_at: -1 })
    .lean<Array<{ product_id: any; estimated_cost_per_batch: number; yield_qty: number }>>();

  const seen = new Set<string>();
  for (const r of recipes) {
    const key = String(r.product_id);
    if (seen.has(key)) continue;
    seen.add(key);
    const unit =
      r.yield_qty && r.yield_qty > 0
        ? Math.round((r.estimated_cost_per_batch / r.yield_qty) * 100) / 100
        : null;
    out.set(key, unit);
  }
  return out;
}

export default recipeService;
