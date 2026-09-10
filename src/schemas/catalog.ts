/**
 * schemas/catalog — validation ของ CRUD แคตตาล็อกเรียบง่าย (unit / product-category / banner)
 * ใช้กับ crudRoutes option `validate: { create, update }`
 */
import { z } from "zod";

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

// ── Product category ────────────────────────────────────────
export const productCategoryCreate = z.object({
  product_category_name: z.string().trim().min(1).max(100),
});
export const productCategoryUpdate = productCategoryCreate.partial();

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
