/**
 * schemas/billDelivery — PATCH /api/shop/orders/:id/delivery · /api/shop/preorders/:id/delivery
 * ลูกค้าแก้วิธีรับสินค้า/ที่อยู่ของบิลที่ยังไม่ชำระ (services/billDeliveryService.ts)
 */
import { z } from "zod";
import { objectId, deliveryAddress, phone } from "./common";

export const editBillDeliveryBody = z
  .object({
    order_type: z.enum(["delivery", "takeaway"]),
    address_id: objectId.nullish(),
    recipient_name: z.string().trim().min(1).max(200).nullish(),
    recipient_phone: phone.nullish(),
    delivery_address: deliveryAddress.nullish(),
    pickup_location_id: objectId.nullish(),
    pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "pickup_date ต้องเป็น YYYY-MM-DD").nullish(),
  })
  .refine((d) => d.order_type !== "delivery" || Boolean(d.address_id) !== Boolean(d.delivery_address), {
    message: "การจัดส่งแบบ delivery ต้องระบุ address_id หรือ delivery_address อย่างใดอย่างหนึ่งเท่านั้น",
    path: ["address_id"],
  })
  .refine((d) => !d.address_id || Boolean(d.recipient_name && d.recipient_phone), {
    message: "ใช้ address_id ต้องระบุ recipient_name และ recipient_phone มาด้วย",
    path: ["recipient_name"],
  });
export type EditBillDeliveryBody = z.infer<typeof editBillDeliveryBody>;
