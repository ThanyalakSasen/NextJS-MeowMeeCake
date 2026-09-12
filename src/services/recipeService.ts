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
import { toSatang, toBahtFields } from "../lib/money";

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
  // BACKLOG §3.11 เฟส 4 — estimated_cost_per_batch เก็บเป็นสตางค์ (integer) แล้ว เหมือน componentService:
  //   1) auto-calc → ingCost/compCost มาจาก DB (satang อยู่แล้ว) ปัด Math.round() ตรง ๆ เป็น integer
  //      สตางค์ (ไม่ใช่ ×100/100 แบบเดิมที่ปัดทศนิยมบาท 2 ตำแหน่ง — ไม่มีความหมายอีกต่อไป)
  //   2) ส่งมาเอง → เป็นบาททศนิยมตาม API contract ต้องแปลงเป็นสตางค์เอง
  const hasItemsInfo = input.ingredients !== undefined || input.components !== undefined;
  if ((isCreate || hasItemsInfo) && input.estimated_cost_per_batch == null) {
    const ingCost = await ingredientItemsCost(input.ingredients ?? [], ingredientModel as Model<any>);
    const compCost = await componentItemsCost(input.components ?? [], componentModel as Model<any>);
    input.estimated_cost_per_batch = Math.round(ingCost + compCost);
  } else if (input.estimated_cost_per_batch != null) {
    input.estimated_cost_per_batch = toSatang(Number(input.estimated_cost_per_batch));
  }
}

// BACKLOG §3.11 เฟส 4 — estimated_cost_per_batch เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
function presentRecipe<T extends Record<string, unknown>>(doc: T): T {
  return toBahtFields(doc, ["estimated_cost_per_batch"] as const);
}

/** getExpanded() populate ทั้ง ingredients.ingredient_id (cost_per_unit) และ components.component_id
 *  (estimated_cost_per_batch) เป็น object เต็ม — เส้นทาง populate ไม่ผ่าน presenter ของ service เจ้าของ
 *  เลย ต้องแปลงซ้อนเองทั้งสองจุด เหมือน componentService.presentExpandedComponent() */
function presentExpandedRecipe(doc: Record<string, any>): Record<string, any> {
  const presented = presentRecipe(doc);
  return {
    ...presented,
    ingredients: (presented.ingredients ?? []).map((it: any) => ({
      ...it,
      ingredient_id:
        it.ingredient_id && typeof it.ingredient_id === "object"
          ? toBahtFields(it.ingredient_id, ["cost_per_unit"] as const)
          : it.ingredient_id,
    })),
    components: (presented.components ?? []).map((it: any) => ({
      ...it,
      component_id:
        it.component_id && typeof it.component_id === "object"
          ? toBahtFields(it.component_id, ["estimated_cost_per_batch"] as const)
          : it.component_id,
    })),
  };
}

export const recipeService = {
  ...base,

  async list(args: Parameters<typeof base.list>[0]) {
    const result = await base.list(args);
    return { ...result, items: result.items.map(presentRecipe) };
  },

  async getById(id: string, includeDeleted?: boolean) {
    return presentRecipe(await base.getById(id, includeDeleted));
  },

  async create(input: Record<string, any>) {
    for (const f of ["recipe_name", "product_id", "yield_qty", "yield_unit_id", "created_by"] as const) {
      if (input[f] == null || input[f] === "") throw badRequest(`กรุณาระบุ ${f}`);
    }
    await assertRefExists(productModel, input.product_id, "สินค้า", "product_id");
    await assertRefExists(userModel, input.created_by, "ผู้สร้าง", "created_by");
    await prepare(input, true);
    // created_by ไม่ได้อยู่ใน WRITABLE (กัน mass-assign ที่ layer อื่น) — ใส่ตรงนี้เอง
    const doc = await recipeModel.create({ ...pickWritable(input), created_by: input.created_by });
    return presentRecipe(doc.toObject());
  },

  async update(id: string, input: Record<string, any>) {
    await prepare(input, false);
    return presentRecipe(await base.update(id, input));
  },

  async remove(id: string) {
    return presentRecipe(await base.remove(id));
  },

  async restore(id: string) {
    return presentRecipe(await base.restore(id));
  },

  /** สูตรทั้งหมดของสินค้าตัวหนึ่ง */
  async listByProduct(productId: string) {
    await dbConnect();
    assertObjectId(productId, "product_id");
    const items = await recipeModel
      .find({ product_id: productId, deleted_at: null })
      .populate("yield_unit_id", "unit_name unit_abbr")
      .sort({ created_at: -1 })
      .lean();
    return items.map(presentRecipe);
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
    return presentExpandedRecipe(recipe);
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
 * ลำดับความสำคัญ: 1) สูตรล่าสุดที่มี yield_qty > 0  2) product.purchase_cost ที่แอดมินกรอกมือ
 * (BACKLOG §3.16 — เผื่อสินค้าที่ไม่มีสูตร เช่น ซื้อมาขายต่อ)  3) null (ไม่มีข้อมูลต้นทุนเลย)
 *
 * BACKLOG §3.11 เฟส 4 — ฟังก์ชันนี้เป็น "internal only" ไม่เคย expose ตรงผ่าน API เลย (ใช้แค่ภายใน
 * orderService/preorderService ตอน snapshot cost_per_unit ลง item) จึงตั้งใจคืนค่าเป็น**สตางค์**
 * ไม่ใช่บาท — ไม่ต้องผ่าน presenter เพราะ orderItemModel/preorderItemModel.cost_per_unit ก็เก็บเป็น
 * สตางค์เหมือนกันแล้ว (รับค่ามาใช้ตรง ๆ ได้เลยไม่ต้องแปลง) ทั้งฝั่งสูตร (estimated_cost_per_batch
 * มาจาก DB เป็นสตางค์อยู่แล้ว) และฝั่ง purchase_cost fallback (แปลงเป็นสตางค์ใน productService แล้ว
 * เช่นกัน) — **ทั้งสองฝั่งต้องแปลงพร้อมกันเสมอ** ไม่งั้น Map ที่คืนจะมีหน่วยปนกันโดยไม่มีทางรู้จาก
 * ภายนอกว่าค่าไหนมาจากไหน (นี่คือเหตุผลที่ purchase_cost ถูกดึงเข้ามาแปลงในเฟส 4 พร้อมกัน แทนที่จะ
 * รอเฟส 5 กับ product pricing ตัวอื่น — ดู docs/hardening-5-money-phase1.md §7)
 * คืน Map<productId, number(สตางค์) | null> — null = ไม่มีทั้งสูตรและ purchase_cost
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
    // ปัดเป็นจำนวนเต็มสตางค์ตรง ๆ (ไม่ใช่ ×100/100 แบบเดิมที่ปัดทศนิยมบาท 2 ตำแหน่ง — ไม่มีความหมาย
    // อีกต่อไปเพราะทั้งตัวตั้งและผลลัพธ์เป็นสตางค์แล้ว)
    const unit =
      r.yield_qty && r.yield_qty > 0 ? Math.round(r.estimated_cost_per_batch / r.yield_qty) : null;
    out.set(key, unit);
  }

  // fallback: สินค้าที่ยังไม่มีต้นทุนจากสูตร (ไม่มีสูตรเลย หรือมีแต่ yield_qty = 0) ใช้ purchase_cost ที่กรอกมือแทน
  // productModel.purchase_cost เก็บเป็นสตางค์แล้วเช่นกัน (BACKLOG §3.11 เฟส 4) — ใช้ค่าดิบจาก DB ตรง ๆ
  // ได้เลย ไม่ต้องแปลง (สอดคล้องกับฝั่งสูตรด้านบนที่เป็นสตางค์เหมือนกัน)
  const missing = validIds.filter((id) => out.get(id) == null);
  if (missing.length > 0) {
    const products = await productModel
      .find({ _id: { $in: missing } })
      .select("purchase_cost")
      .lean<Array<{ _id: any; purchase_cost?: number | null }>>();
    for (const p of products) {
      if (p.purchase_cost != null) out.set(String(p._id), p.purchase_cost);
    }
  }
  return out;
}

export default recipeService;
