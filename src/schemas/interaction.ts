/**
 * schemas/interaction — validation ของ POST /api/shop/interactions
 */
import { z } from "zod";
import { objectId } from "./common";

// รับจากหน้าเว็บแค่ "view" — add_to_cart บันทึกฝั่ง server ใน cartService.addItem เอง
// ส่วน wishlist (favoriteService) / purchase (Orders) มีแหล่งข้อมูลอยู่แล้ว ไม่ให้ client ส่งมาเอง (กันปลอม/นับซ้ำ)
export const trackInteractionBody = z.object({
  product_id: objectId,
  action_type: z.literal("view"),
});
export type TrackInteractionBody = z.infer<typeof trackInteractionBody>;
