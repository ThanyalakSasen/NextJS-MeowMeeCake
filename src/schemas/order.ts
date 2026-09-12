/**
 * schemas/order — validation ของ /api/shop/orders + /api/admin/orders (POST)
 */
import { z } from "zod";
import { objectId, deliveryAddress, phone } from "./common";

const orderLine = z.object({
  product_id: objectId,
  variant_id: objectId.nullish(),
  selected_options: z
    .array(z.object({ option_id: objectId, text_value: z.string().max(500).nullish() }))
    .default([]),
  special_request: z.string().max(500).nullish(),
  quantity: z.number().int().min(1),
});

/** field ที่ทั้งฝั่งลูกค้าและแอดมินส่งเหมือนกัน — แอดมิน .extend() ทับด้วย field เพิ่มด้านล่าง */
const orderBodyBase = z.object({
  // ไม่ส่ง source = "cart" (สร้างจากตะกร้า) · "items" = ระบุรายการเอง
  source: z.enum(["cart", "items"]).default("cart"),
  order_type: z.enum(["delivery", "takeaway"]),
  // ที่อยู่จัดส่ง — ระบุอย่างใดอย่างหนึ่ง (BACKLOG §3.8): address_id (จากสมุดที่อยู่ — สมุดที่อยู่
  // เก็บแค่ตำแหน่ง ไม่เก็บชื่อ/เบอร์ผู้รับ เลยต้องส่ง recipient_name/recipient_phone มาคู่กันเสมอ
  // เผื่อกรณีสั่งให้คนอื่น) หรือ delivery_address (กรอกที่อยู่ใหม่ทั้งก้อนแบบเดิม รวมชื่อ/เบอร์ในตัว)
  address_id: objectId.nullish(),
  recipient_name: z.string().trim().min(1).max(200).nullish(),
  recipient_phone: phone.nullish(),
  delivery_address: deliveryAddress.nullish(),
  promotion_code: z.string().trim().min(1).nullish(),
  promotion_id: objectId.nullish(),
  items: z.array(orderLine).optional(),
  item_notes: z.record(z.string(), z.string()).optional(),
});

// เงื่อนไขร่วมของทั้งฝั่งลูกค้า/แอดมิน — เขียนซ้ำ 2 รอบแทนดึงเป็นฟังก์ชันกลาง เพราะ zod v4
// ไม่ให้ .extend() schema ที่ผ่าน .refine() มาแล้ว (คืน ZodEffects ไม่ใช่ ZodObject) และ generic
// helper ที่รับ ZodObject แบบไม่ระบุ shape ทำให้ TS อนุมาน field ใน callback เป็น unknown ไปด้วย —
// .extend() ต้องมาก่อน .refine() เสมอ ต่างชุด field (admin เพิ่ม user_id ฯลฯ) เลย refine แยกกัน

export const createOrderBody = orderBodyBase
  .refine((d) => !(d.promotion_code && d.promotion_id), {
    message: "ส่ง promotion_code หรือ promotion_id อย่างใดอย่างหนึ่ง",
    path: ["promotion_code"],
  })
  .refine((d) => d.source !== "items" || (d.items?.length ?? 0) > 0, {
    message: "source=items ต้องมี items อย่างน้อย 1 รายการ",
    path: ["items"],
  })
  .refine((d) => d.order_type !== "delivery" || Boolean(d.address_id) !== Boolean(d.delivery_address), {
    message: "การจัดส่งแบบ delivery ต้องระบุ address_id หรือ delivery_address อย่างใดอย่างหนึ่งเท่านั้น",
    path: ["address_id"],
  })
  .refine((d) => !d.address_id || Boolean(d.recipient_name && d.recipient_phone), {
    message: "ใช้ address_id ต้องระบุ recipient_name และ recipient_phone มาด้วย",
    path: ["recipient_name"],
  });
export type CreateOrderBody = z.infer<typeof createOrderBody>;

/** POST /api/admin/orders — สร้างแทนลูกค้า: เพิ่ม user_id (บังคับ), delivery_fee (override
 *  ค่าส่งที่ระบบคิดเอง), discount_amount (ส่วนลดกรอกมือ — ใช้เมื่อไม่ได้ระบุโปรโมชัน), channel */
export const adminCreateOrderBody = orderBodyBase
  .extend({
    user_id: objectId,
    delivery_fee: z.coerce.number().min(0).nullish(),
    discount_amount: z.coerce.number().min(0).nullish(),
    channel: z.enum(["online", "instore"]).default("instore"),
  })
  .refine((d) => !(d.promotion_code && d.promotion_id), {
    message: "ส่ง promotion_code หรือ promotion_id อย่างใดอย่างหนึ่ง",
    path: ["promotion_code"],
  })
  .refine((d) => d.source !== "items" || (d.items?.length ?? 0) > 0, {
    message: "source=items ต้องมี items อย่างน้อย 1 รายการ",
    path: ["items"],
  })
  .refine((d) => d.order_type !== "delivery" || Boolean(d.address_id) !== Boolean(d.delivery_address), {
    message: "การจัดส่งแบบ delivery ต้องระบุ address_id หรือ delivery_address อย่างใดอย่างหนึ่งเท่านั้น",
    path: ["address_id"],
  })
  .refine((d) => !d.address_id || Boolean(d.recipient_name && d.recipient_phone), {
    message: "ใช้ address_id ต้องระบุ recipient_name และ recipient_phone มาด้วย",
    path: ["recipient_name"],
  });
export type AdminCreateOrderBody = z.infer<typeof adminCreateOrderBody>;

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

/** PATCH /api/admin/orders/[id]/delivery — ตรงกับ orderService.updateDelivery() */
export const updateDeliveryBody = z.object({
  delivery_status: z.enum(["pending", "shipping", "delivered", "failed"]).optional(),
  tracking_no: z.string().trim().max(200).nullish(),
  shipped_at: z.coerce.date().nullish(),
  delivered_at: z.coerce.date().nullish(),
  delivered_note: z.string().trim().max(1000).nullish(),
});
export type UpdateDeliveryBody = z.infer<typeof updateDeliveryBody>;
