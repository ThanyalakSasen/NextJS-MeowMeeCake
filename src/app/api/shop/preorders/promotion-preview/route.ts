/**
 * POST /api/shop/preorders/promotion-preview — เช็คโค้ดส่วนลดกับพรีออเดอร์ที่กำลังจะสั่ง (ยังไม่สร้างเอกสาร)
 *   body: เหมือน POST /api/shop/preorders + promotion_code (บังคับ)
 *   → { promotion_code, discount_amount, free_shipping, discount_type, eligible_amount, subtotal, delivery_fee }
 *   ราคา/ค่าส่งคิดชุดเดียวกับตอนสั่งจริง (preorderService.createPreorder · previewPromotion)
 *   ไม่ผ่านเงื่อนไข → 422 พร้อมข้อความ · rate-limit 20 ครั้ง/นาที ต่อ IP เหมือน /shop/promotions/validate (กันเดารหัส)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import { parseBody } from "@/lib/validate";
import { createPreorderBody } from "@/schemas/preorder";
import * as preorderService from "@/services/preorderService";
import * as addressService from "@/services/addressService";

export const POST = withAuth(async (session, req) => {
  await rateLimit(clientIp(req), "promotions:validate", { limit: 20, windowMs: 60_000 });
  const body = await parseBody(req, createPreorderBody);
  if (!body.promotion_code) throw badRequest("กรุณาระบุโค้ดส่วนลด");
  const delivery_address = await addressService.resolveDeliverySnapshot(session.user_id, body);
  const result = await preorderService.previewPreorderPromotion(session.user_id, {
    round_id: body.round_id,
    order_type: body.order_type,
    delivery_address,
    items: body.items,
    pickup_location_id: body.pickup_location_id ?? null,
    pickup_date: body.pickup_date ?? null,
    promotion_code: body.promotion_code,
  });
  return ok(result);
});
