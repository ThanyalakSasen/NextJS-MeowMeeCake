/**
 * POST /api/shop/points/convert — { points } แลกแต้มเป็นคูปองส่วนลดบาท (หน้าสมาชิก · 2026-10-26) → 201 คูปอง
 *   100 แต้ม = ฿10 · ขั้นต่ำ 100 แต้ม · ทีละ 10 แต้ม · แต้มไม่พอ/ไม่ตรงขั้น = 400
 *   ได้คูปอง 1 ใบ (คูปองของฉัน) เลือกใช้ที่หน้าชำระเงิน
 */
import { created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as couponService from "@/services/couponService";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => ({}));
  return created(await couponService.convertPointsToCoupon(session.user_id, body?.points));
});
