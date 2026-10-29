/**
 * productCategoryService — CRUD หมวดหมู่สินค้า (ProductCategories)
 */
import productCategoryModel from "../models/productCategoryModel";
import productModel from "../models/productModel";
import { createCrudService } from "../lib/crudService";
import { conflict } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";

const base = createCrudService(productCategoryModel, {
  label: "หมวดหมู่สินค้า",
  searchFields: ["product_category_name"],
  // ships_nationwide — ส่งทั่วประเทศได้ไหม (ออเดอร์เว็บ · src/lib/shipping.ts)
  createFields: ["product_category_name", "ships_nationwide"],
});

export const productCategoryService = {
  ...base,
  // เหมือนหมวดวัตถุดิบ/ส่วนประกอบ — เดิมกันแค่หน้าเว็บ (นับก่อนลบ) ยิง API ตรงลบหมวดที่มีสินค้าได้
  async remove(id: string) {
    assertObjectId(id); // ก่อน query การใช้งาน — id ผิดรูปแบบต้องได้ 400 ไม่ใช่ CastError 500
    const inUse = await productModel.exists({ category_id: id, deleted_at: null }).lean();
    if (inUse) throw conflict("ลบไม่ได้ เพราะยังมีสินค้าที่ใช้หมวดหมู่นี้อยู่");
    return base.remove(id);
  },
};

export default productCategoryService;
