/**
 * schemas/production — validation ของการบันทึกใบสั่งผลิตทั้งใบ (PUT /api/admin/production-orders/[id]/edit)
 * ตรวจรูปร่างเท่านั้น · กติกาธุรกิจ (สถานะใบ / รายการเป็นของใบนี้ / หักสต็อกแล้ว / สูตรตรงสินค้า) อยู่ที่ service
 */
import { z } from "zod";
import { objectId } from "./common";

const qty = z.number().int().positive();
const notes = z.string().max(1000).nullable().optional();

export const productionOrderEditBody = z.object({
  production_date: z.string().min(1).optional(),
  assigned_to: objectId.nullable().optional(),
  production_note: z.string().max(1000).nullable().optional(),
  items: z
    .object({
      remove: z.array(objectId).max(200).default([]),
      update: z.array(z.object({ item_id: objectId, planned_qty: qty, notes })).max(200).default([]),
      add: z
        .array(z.object({ product_id: objectId, recipe_id: objectId, planned_qty: qty, notes }))
        .max(200)
        .default([]),
    })
    .optional(),
});
export type ProductionOrderEditBody = z.infer<typeof productionOrderEditBody>;
