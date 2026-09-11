/**
 * ingredientCategoryService — CRUD หมวดหมู่วัตถุดิบ (IngredientCategory)
 */
import ingredientCategoryModel from "../models/ingredientCategoryModel";
import ingredientModel from "../models/ingredientModel";
import { createCrudService } from "../lib/crudService";
import { conflict } from "../lib/httpError";

/* eslint-disable @typescript-eslint/no-explicit-any */

const base = createCrudService(ingredientCategoryModel as any, {
  label: "หมวดหมู่วัตถุดิบ",
  searchFields: ["ingredient_category_name"],
  createFields: ["ingredient_category_name"],
});

export const ingredientCategoryService = {
  ...base,
  async remove(id: string) {
    const inUse = await ingredientModel
      .exists({ ingredient_category_id: id, deleted_at: null })
      .lean();
    if (inUse) throw conflict("ลบไม่ได้ เพราะยังมีวัตถุดิบที่ใช้หมวดหมู่นี้อยู่");
    return base.remove(id);
  },
};

export default ingredientCategoryService;
