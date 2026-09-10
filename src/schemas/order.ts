/**
 * schemas/order — validation ของ /api/shop/orders (+ ใช้ต่อกับ admin orders ภายหลัง)
 */
import { z } from "zod";
import { objectId, deliveryAddress } from "./common";

const orderLine = z.object({
  product_id: objectId,
  variant_id: objectId.nullish(),
  selected_options: z
    .array(z.object({ option_id: objectId, text_value: z.string().max(500).nullish() }))
    .default([]),
  special_request: z.string().max(500).nullish(),
  quantity: z.number().int().min(1),
});

export const createOrderBody = z
  .object({
    // ไม่ส่ง source = "cart" (สร้างจากตะกร้า) · "items" = ระบุรายการเอง
    source: z.enum(["cart", "items"]).default("cart"),
    order_type: z.enum(["delivery", "takeaway"]),
    delivery_address: deliveryAddress.nullish(),
    promotion_code: z.string().trim().min(1).nullish(),
    promotion_id: objectId.nullish(),
    items: z.array(orderLine).optional(),
    item_notes: z.record(z.string(), z.string()).optional(),
  })
  .refine((d) => !(d.promotion_code && d.promotion_id), {
    message: "ส่ง promotion_code หรือ promotion_id อย่างใดอย่างหนึ่ง",
    path: ["promotion_code"],
  })
  .refine((d) => d.source !== "items" || (d.items?.length ?? 0) > 0, {
    message: "source=items ต้องมี items อย่างน้อย 1 รายการ",
    path: ["items"],
  });
export type CreateOrderBody = z.infer<typeof createOrderBody>;

/** query ของ GET /api/shop/orders — เฉพาะ enum ที่ต้อง validate
 *  (page/limit/sort ยังใช้ parsePagination/parseSort เดิม เพราะ clamp/whitelist ให้อยู่แล้ว) */
export const listOrderQuery = z.object({
  order_status: z
    .enum(["pending", "confirmed", "preparing", "ready", "completed", "cancelled"])
    .optional(),
  payment_status: z.enum(["pending", "paid", "failed", "refunded"]).optional(),
  order_type: z.enum(["delivery", "takeaway"]).optional(),
});
export type ListOrderQuery = z.infer<typeof listOrderQuery>;
