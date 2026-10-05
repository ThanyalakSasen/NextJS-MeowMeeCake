/**
 * GET /api/shop/preorders/[id]/payment — หน้าชำระเงินของพรีออเดอร์ (เจ้าของเท่านั้น)
 *   คืน QR พร้อมเพย์ตามยอด + สถานะ + สลิปล่าสุด + กำหนดชำระ (payment_due_at · server_time)
 *   ส่งสลิป: ใช้ /api/shop/payments (+ /[id]/slip) เดิม — docs/customer-backend-merge.md §8.8
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as paymentService from "@/services/paymentService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await paymentService.getPaymentPage("preorder", id, session.user_id));
});
