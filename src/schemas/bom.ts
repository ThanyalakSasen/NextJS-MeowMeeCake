/**
 * schemas/bom — validation ของสูตร/ส่วนประกอบ (Bill of Materials)
 *   component = ส่วนประกอบกึ่งสำเร็จรูป (มี ingredients[])
 *   recipe    = สูตรผลิตสินค้า (มี ingredients[] + components[] ซ้อน)
 * ใช้กับ crudRoutes option `validate: { create, update }` (route: /api/admin/components, /recipes)
 *
 * business rule เพิ่มเติม (ref มีจริง, คิด estimated_cost_per_batch อัตโนมัติ) ตรวจต่อใน
 * componentService / recipeService + src/lib/bom.ts
 *
 * `created_by` ไม่อยู่ใน schema — route inject จาก session ผ่าน `collectionRoutes` option
 * `createInject` (กัน client ตั้งเอง)
 */
import { z } from "zod";
import { objectId } from "./common";

const ingredientItem = z.object({
  ingredient_id: objectId,
  quantity: z.coerce.number().min(0),
  unit_id: objectId,
});

const componentItem = z.object({
  component_id: objectId,
  quantity: z.coerce.number().min(0),
  unit_id: objectId,
});

// ── Component ──────────────────────────────────────────────
export const componentCreate = z.object({
  component_name: z.string().trim().min(1).max(120),
  componentcategory_id: objectId,
  yield_qty: z.coerce.number().min(0),
  yield_unit_id: objectId,
  estimated_cost_per_batch: z.coerce.number().min(0).optional(),
  steps_content: z.string().max(20000).nullable().optional(),
  note: z.string().max(2000).optional(),
  ingredients: z.array(ingredientItem).optional(),
});
// update: ห้ามย้ายหมวดหมู่ (ตรงกับ updateFields ใน componentService)
export const componentUpdate = componentCreate.omit({ componentcategory_id: true }).partial();

// ── Recipe ────────────────────────────────────────────────
export const recipeCreate = z.object({
  recipe_name: z.string().trim().min(1).max(120),
  product_id: objectId,
  yield_qty: z.coerce.number().min(0),
  yield_unit_id: objectId,
  estimated_cost_per_batch: z.coerce.number().min(0).optional(),
  duration_minutes: z.coerce.number().min(0).optional(),
  steps_content: z.string().max(20000).nullable().optional(),
  note: z.string().max(2000).optional(),
  ingredients: z.array(ingredientItem).optional(),
  components: z.array(componentItem).optional(),
});
// update: ห้ามย้ายสินค้า (ตรงกับ updateFields ใน recipeService)
export const recipeUpdate = recipeCreate.omit({ product_id: true }).partial();
