/**
 * productCategoryService — CRUD หมวดหมู่สินค้า (ProductCategories)
 * เอนทิตีเรียบง่าย ใช้ crudService factory ตรง ๆ
 */
import productCategoryModel from "../models/productCategoryModel";
import { createCrudService } from "../lib/crudService";

export const productCategoryService = createCrudService(productCategoryModel, {
  label: "หมวดหมู่สินค้า",
  searchFields: ["product_category_name"],
  createFields: ["product_category_name"],
});

export default productCategoryService;
