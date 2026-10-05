/**
 * schemas/preorder — validation ของ /api/shop/preorders (BACKLOG2 §8 — เดิมยังไม่ zod-adopt เลย
 * ต่างจาก /api/shop/orders ที่ใช้ createOrderBody/listOrderQuery ใน schemas/order.ts)
 */
import { z } from "zod";
import { objectId, deliveryAddress, phone } from "./common";

const preorderLine = z.object({
  round_item_id: objectId,
  quantity: z.number().int().min(1),
  // กลุ่มตัวเลือก + ออปชันเสริม (docs/customer-backend-merge.md §8)
  variant_ids: z.array(objectId).max(50).nullish(),
  variant_id: objectId.nullish(),
  selected_options: z
    .array(z.object({ option_id: objectId, text_value: z.string().max(500).nullish() }))
    .default([]),
  special_request: z.string().max(500).nullish(),
});

/** POST /api/shop/preorders — เงื่อนไขที่อยู่จัดส่งเหมือน createOrderBody (BACKLOG §3.8) ทุกประการ:
 *  ระบุ address_id (จากสมุดที่อยู่ + recipient_name/recipient_phone) หรือ delivery_address
 *  (กรอกใหม่ทั้งก้อน) อย่างใดอย่างหนึ่งเท่านั้น — เดิมพรีออเดอร์รับแค่ delivery_address อย่างเดียว */
export const createPreorderBody = z
  .object({
    round_id: objectId,
    order_type: z.enum(["delivery", "takeaway"]),
    address_id: objectId.nullish(),
    recipient_name: z.string().trim().min(1).max(200).nullish(),
    recipient_phone: phone.nullish(),
    delivery_address: deliveryAddress.nullish(),
    // คูปองของฉัน (แลกด้วยแต้ม — ใช้ร่วมกับโค้ดส่วนลดไม่ได้) + ใช้แต้มเป็นส่วนลด (customer-backend-merge.md §8.11)
    user_coupon_id: objectId.nullish(),
    points_to_redeem: z.number().int().min(0).max(1_000_000).nullish(),
    // takeaway: จุดรับ + วันรับ (ไม่บังคับ — ส่งมาแล้วตรวจกับหน้าร้านประจำสัปดาห์ · docs/customer-backend-merge.md §8.7)
    pickup_location_id: objectId.nullish(),
    pickup_date: z.string().regex(/^d{4}-d{2}-d{2}$/, "pickup_date ต้องเป็น YYYY-MM-DD").nullish(),
    items: z.array(preorderLine).min(1, "ต้องระบุ items อย่างน้อย 1 รายการ"),
  })
  .refine((d) => d.order_type !== "delivery" || Boolean(d.address_id) !== Boolean(d.delivery_address), {
    message: "การจัดส่งแบบ delivery ต้องระบุ address_id หรือ delivery_address อย่างใดอย่างหนึ่งเท่านั้น",
    path: ["address_id"],
  })
  .refine((d) => !d.address_id || Boolean(d.recipient_name && d.recipient_phone), {
    message: "ใช้ address_id ต้องระบุ recipient_name และ recipient_phone มาด้วย",
    path: ["recipient_name"],
  });
export type CreatePreorderBody = z.infer<typeof createPreorderBody>;

/** query ของ GET /api/shop/preorders — เฉพาะ enum ที่ต้อง validate (page/limit/sort ผ่าน
 *  parsePagination/parseSort เดิมอยู่แล้ว) */
export const listPreorderQuery = z.object({
  round_id: objectId.optional(),
  // ค่าเดียวกับ PREORDER_STATUSES/PAYMENT_STATUSES ใน preorderService.ts (state machine เดียวกับ
  // ออเดอร์ปกติ — schemas/order.ts#listOrderQuery ก็ hardcode ค่าเดิมแยกไว้เช่นกัน ไม่ import ข้าม
  // ชั้นจาก service)
  order_status: z
    .enum(["pending", "confirmed", "preparing", "ready", "completed", "cancelled"])
    .optional(),
  payment_status: z.enum(["pending", "paid", "failed", "refunded"]).optional(),
  order_type: z.enum(["delivery", "takeaway"]).optional(),
});
export type ListPreorderQuery = z.infer<typeof listPreorderQuery>;
