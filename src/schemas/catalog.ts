/**
 * schemas/catalog — validation ของ CRUD แคตตาล็อกเรียบง่าย
 * (unit / product-category / banner / product-option / product-variant)
 * ใช้กับ crudRoutes option `validate: { create, update }`
 */
import { z } from "zod";
import { objectId } from "./common";

const UNIT_TYPES = [
  "IngredientWeight",
  "IngredientVolume",
  "ProductWeight",
  "ProductVolume",
  "ProductCount",
  "Package",
  "Sheet",
  "Tray",
  "Slice",
  "Piece",
  "Custom",
] as const;
const USAGE_CONTEXT = ["Ingredient", "Product", "Both"] as const;

// ── Unit ────────────────────────────────────────────────────
export const unitCreate = z.object({
  unit_name: z.string().trim().min(1).max(60),
  unit_abbr: z.string().trim().min(1).max(20),
  unit_type: z.enum(UNIT_TYPES),
  usage_context: z.array(z.enum(USAGE_CONTEXT)).min(1),
});
export const unitUpdate = unitCreate.partial();

// ── หมวดหมู่แบบชื่อล้วน (product / ingredient / component category) ──
const nameOnly = (field: string, max = 100) => z.object({ [field]: z.string().trim().min(1).max(max) });

export const productCategoryCreate = nameOnly("product_category_name");
export const productCategoryUpdate = productCategoryCreate.partial();

export const ingredientCategoryCreate = nameOnly("ingredient_category_name");
export const ingredientCategoryUpdate = ingredientCategoryCreate.partial();

export const componentCategoryCreate = nameOnly("component_category_name");
export const componentCategoryUpdate = componentCategoryCreate.partial();

// ── Banner ─────────────────────────────────────────────────
export const bannerCreate = z.object({
  banner_name: z.string().trim().min(1).max(120),
  banner_description: z.string().trim().max(500).optional(),
  banner_img: z.string().trim().min(1).max(1000),
  banner_link: z.string().trim().max(1000).optional(),
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
  sort_order: z.number().int().min(0),
  is_active: z.boolean().optional(),
});
export const bannerUpdate = bannerCreate.partial();

// ── Product option (ตัวเลือกเสริม — เขียนข้อความ / ท็อปปิ้ง) ──
// business rule is_text_input ↔ max_text_length ตรวจต่อใน productOptionService.validateShape
export const productOptionCreate = z.object({
  product_id: objectId,
  option_name: z.string().trim().min(1).max(120),
  is_text_input: z.boolean().optional(),
  max_text_length: z.coerce.number().int().min(1).max(500).nullable().optional(),
  extra_price: z.coerce.number().min(0).optional(),
  is_required: z.boolean().optional(),
});
// update: ห้ามย้าย product_id (ตรงกับ updateFields ใน service)
export const productOptionUpdate = productOptionCreate.omit({ product_id: true }).partial();

// ── Product variant (รสชาติ / ขนาด — มีราคาเพิ่ม + สต็อกแยก) ──
export const productVariantCreate = z.object({
  product_id: objectId,
  variant_name: z.string().trim().min(1).max(120),
  variant_price: z.coerce.number().min(0).optional(),
  variant_stock: z.coerce.number().min(0).optional(),
  unit_id: objectId.optional(),
});
// update: ห้ามย้าย product_id (ตรงกับ updateFields ใน service)
export const productVariantUpdate = productVariantCreate.omit({ product_id: true }).partial();
