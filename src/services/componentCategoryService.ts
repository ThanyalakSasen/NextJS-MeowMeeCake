/**
 * componentCategoryService — CRUD หมวดหมู่ส่วนประกอบ/กึ่งสำเร็จรูป (ComponentCategory)
 *
 * NOTE: componentModel.componentcategory_id ระบุ ref เป็น "ComponentCategories" (พหูพจน์)
 * แต่ model จริงลงทะเบียนชื่อ "ComponentCategory" (เอกพจน์) — populate ต้องส่ง model ตรง ๆ
 * (ดู componentService) ที่นี่ไม่กระทบเพราะไม่ได้ populate
 */
import componentCategoryModel from "../models/componentsCategory";
import componentModel from "../models/componentModel";
import { createCrudService } from "../lib/crudService";
import { conflict } from "../lib/httpError";

/* eslint-disable @typescript-eslint/no-explicit-any */

const base = createCrudService(componentCategoryModel as any, {
  label: "หมวดหมู่ส่วนประกอบ",
  searchFields: ["component_category_name"],
  createFields: ["component_category_name"],
});

export const componentCategoryService = {
  ...base,
  async remove(id: string) {
    const inUse = await componentModel
      .exists({ componentcategory_id: id, deleted_at: null })
      .lean();
    if (inUse) throw conflict("ลบไม่ได้ เพราะยังมีส่วนประกอบที่ใช้หมวดหมู่นี้อยู่");
    return base.remove(id);
  },
};

export default componentCategoryService;
