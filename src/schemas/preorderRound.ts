/**
 * schemas/preorderRound — validation ของ /api/admin/preorder-rounds* (custom routes)
 */
import { z } from "zod";
import { objectId } from "./common";

const ROUND_STATUSES = ["scheduled", "open", "closed", "cancelled"] as const;

const roundItem = z.object({
  product_id: objectId,
  price_override: z.coerce.number().min(0).nullish(),
  min_order_qty: z.coerce.number().int().min(1).optional(),
  max_qty_total: z.coerce.number().int().min(1),
  is_active: z.boolean().optional(),
});

/** POST /api/admin/preorder-rounds — สร้างรายการสินค้าในรอบไปพร้อมกันได้เลย (ไม่บังคับ) */
export const createRoundBody = z.object({
  round_name: z.string().trim().min(1).max(200),
  open_date: z.coerce.date(),
  close_date: z.coerce.date(),
  pickup_date: z.coerce.date(),
  round_status: z.enum(ROUND_STATUSES).optional(),
  items: z.array(roundItem).optional(),
});
export type CreateRoundBody = z.infer<typeof createRoundBody>;

/** PATCH /api/admin/preorder-rounds/[id] — แก้ได้เฉพาะชื่อ + ช่วงเวลา ต้องส่งมาอย่างน้อย 1 ฟิลด์ */
export const updateRoundBody = z
  .object({
    round_name: z.string().trim().min(1).max(200).optional(),
    open_date: z.coerce.date().optional(),
    close_date: z.coerce.date().optional(),
    pickup_date: z.coerce.date().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "ไม่มีฟิลด์ที่อนุญาตให้แก้ไข (round_name/open_date/close_date/pickup_date)",
  });
export type UpdateRoundBody = z.infer<typeof updateRoundBody>;

/** POST /api/admin/preorder-rounds/[id]/items — เพิ่มสินค้าเข้ารอบ */
export const addRoundItemBody = roundItem;
export type AddRoundItemBody = z.infer<typeof addRoundItemBody>;

/** PATCH /api/admin/preorder-round-items/[id] — ต้องส่งมาอย่างน้อย 1 ฟิลด์ */
export const updateRoundItemBody = z
  .object({
    price_override: z.coerce.number().min(0).nullish(),
    min_order_qty: z.coerce.number().int().min(1).optional(),
    max_qty_total: z.coerce.number().int().min(1).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "ไม่มีฟิลด์ที่อนุญาตให้แก้ไข (price_override/min_order_qty/max_qty_total/is_active)",
  });
export type UpdateRoundItemBody = z.infer<typeof updateRoundItemBody>;
