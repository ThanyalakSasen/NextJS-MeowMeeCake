/**
 * POST /api/shop/payment-link — ออกลิงก์หน้าชำระเงินแบบใช้ครั้งเดียว (อายุ 30 นาที) หลัง checkout
 *   body: { kind?: "order" | "preorder", id }  (รูปแบบเดิม { orderId } ยังใช้ได้ = ออเดอร์ปกติ)
 *   คืน { token, kind, expires_at } → หน้าเว็บไปหน้าชำระเงินพร้อม #t=<token> · paymentLinkService
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as paymentLinkService from "@/services/paymentLinkService";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => ({}));
  const kind = paymentLinkService.parseKind(body?.kind);
  const res = ok(await paymentLinkService.createPaymentLink(session.user_id, kind, body?.id ?? body?.orderId));
  res.headers.set("Cache-Control", "no-store");
  return res;
});
