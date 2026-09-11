/**
 * schemas/inventory — validation ของ /api/admin/ingredients (crudRoutes validate)
 * หมายเหตุ: current_stock ตั้งได้เฉพาะตอนสร้าง — แก้ทีหลังผ่าน ingredient-transactions เท่านั้น
 */
import { z } from "zod";
import { objectId } from "./common";

export const ingredientCreate = z.object({
  ingredient_name: z.string().trim().min(1).max(120),
  ingredient_category_id: objectId,
  unit_id: objectId,
  current_stock: z.number().nonnegative().optional(),
  cost_per_unit: z.number().nonnegative(),
  reorder_point: z.number().nonnegative().optional(),
  max_stock: z.number().nonnegative().optional(),
  supplier: z.string().trim().max(200).optional(),
});

export const ingredientUpdate = ingredientCreate.omit({ current_stock: true }).partial();
