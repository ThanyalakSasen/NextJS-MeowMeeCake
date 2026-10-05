/**
 * POST /api/shop/coupons/check — { code } ตรวจโค้ดส่วนลดที่กรอก (ยังไม่นับการใช้) → ข้อมูลไว้คิดส่วนลดล่วงหน้า
 * โค้ดของโปรที่ต้องแลกด้วยแต้ม = 422 · ใช้ /api/shop/promotions/validate ถ้าต้องการยอดจากตะกร้าจริง
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as couponService from "@/services/couponService";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => ({}));
  return ok(await couponService.checkPromotionCode(body?.code, session.user_id));
});
