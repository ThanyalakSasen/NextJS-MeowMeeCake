/**
 * POST /api/shop/coupons/redeem — { promotion_id } แลกแต้มเป็นคูปอง 1 ใบ → 201 คูปอง
 * แต้มไม่พอ/ยังไม่ถึง 100 แต้ม/เกินจำนวนต่อคน = 400 · โปรไม่เปิดให้แลก = 404
 */
import { created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as couponService from "@/services/couponService";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => ({}));
  return created(await couponService.redeemCoupon(session.user_id, body?.promotion_id));
});
