/**
 * POST /api/shop/promotions/validate — ลูกค้าเช็คโค้ดโปรโมชันกับตะกร้าปัจจุบัน ก่อนกดสั่งซื้อ
 *   body: { code | promotion_id, delivery_fee? }
 *   สำเร็จ → { discount_amount, discount_type, free_shipping, eligible_amount, promotion_code }
 *   ไม่ผ่านเงื่อนไข → 422 พร้อมข้อความอธิบาย
 *   rate-limit 20 ครั้ง/นาที ต่อ IP — กันเดารหัสโปรโมชัน (enumeration) เหมือนที่กันเดารหัสผ่านที่ /auth/login
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import * as promotionService from "@/services/promotionService";

export const POST = withAuth(async (session, req) => {
  rateLimit(clientIp(req), "promotions:validate", { limit: 20, windowMs: 60_000 });
  const body = await req.json();
  if (!body.code && !body.promotion_id) throw badRequest("กรุณาระบุ code หรือ promotion_id");
  const result = await promotionService.previewForCart(session.user_id, {
    code: body.code,
    promotion_id: body.promotion_id,
    delivery_fee: body.delivery_fee,
    channel: "online",
  });
  return ok(result);
});
