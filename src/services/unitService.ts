/**
 * unitService — CRUD หน่วยนับ/หน่วยปริมาณ (Units)
 * ใช้ทั้งฝั่งวัตถุดิบ (สูตรขนม) และฝั่งสินค้า
 */
import unitModel from "../models/unitModel";
import ingredientModel from "../models/ingredientModel";
import productModel from "../models/productModel";
import productVariantModel from "../models/productVariantModel";
import recipeModel from "../models/recipeModel";
import componentModel from "../models/componentModel";
import { createCrudService } from "../lib/crudService";
import { conflict } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WRITABLE = [
  "unit_name",
  "unit_abbr",
  "unit_type",
  "usage_context",
] as const;

const base = createCrudService(unitModel, {
  label: "หน่วยนับ",
  searchFields: ["unit_name", "unit_abbr"],
  createFields: WRITABLE,
});

/**
 * ลบหน่วยที่ยังมีของใช้อยู่ไม่ได้ — เดิมลบได้ แล้ววัตถุดิบที่ใช้หน่วยนี้รับเข้า/เบิก/ปรับยอดไม่ได้อีกเลย
 * (ingredientTransactionService ตรวจหน่วยต้องยังไม่ถูกลบ) และปิดงานผลิตที่ใช้สูตรหน่วยนี้ล้ม
 */
const USAGES: Array<[any, (id: string) => Record<string, unknown>, string]> = [
  [ingredientModel, (id) => ({ unit_id: id }), "วัตถุดิบ"],
  [productModel, (id) => ({ unit_id: id }), "สินค้า"],
  [productVariantModel, (id) => ({ unit_id: id }), "ตัวเลือกสินค้า"],
  [recipeModel, (id) => ({ $or: [{ yield_unit_id: id }, { "ingredients.unit_id": id }, { "components.unit_id": id }] }), "สูตร"],
  [componentModel, (id) => ({ $or: [{ yield_unit_id: id }, { "ingredients.unit_id": id }] }), "ส่วนประกอบ"],
];

export const unitService = {
  ...base,
  async remove(id: string) {
    assertObjectId(id); // ก่อน query การใช้งาน — id ผิดรูปแบบต้องได้ 400 ไม่ใช่ CastError 500
    for (const [model, match, label] of USAGES) {
      const inUse = await model.exists({ ...match(id), deleted_at: null }).lean();
      if (inUse) throw conflict(`ลบไม่ได้ เพราะยังมี${label}ที่ใช้หน่วยนี้อยู่`);
    }
    return base.remove(id);
  },
};

export default unitService;
