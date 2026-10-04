/**
 * POST /api/shop/payment-link/redeem — ใช้ token เปิดหน้าชำระเงิน (ครั้งเดียว · ต้องเป็นบัญชีเจ้าของคำสั่งซื้อ)
 *   body: { kind?: "order" | "preorder", token } → { kind, id, orderId } · ใช้ไปแล้ว/หมดอายุ = 410
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as paymentLinkService from "@/services/paymentLinkService";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => ({}));
  const kind = paymentLinkService.parseKind(body?.kind);
  const result = await paymentLinkService.redeemPaymentLink(session.user_id, kind, body?.token);
  // orderId คงไว้ให้หน้าเว็บเดิมที่อ่าน field นี้
  const res = ok({ ...result, orderId: result.id });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
