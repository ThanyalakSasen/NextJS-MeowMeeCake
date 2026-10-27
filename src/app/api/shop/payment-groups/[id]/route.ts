/**
 * GET /api/shop/payment-groups/[id] — หน้าชำระรวม (หลายบิลจากการสั่งซื้อรวม · services/paymentGroupService)
 *   → { bills: [...สถานะแต่ละบิล], total_amount, status, can_pay_together, qr_image, payment_due_at, server_time }
 *   เฉพาะเจ้าของ (ไม่ใช่ของตัวเอง = 404)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as paymentGroupService from "@/services/paymentGroupService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await paymentGroupService.getGroupPaymentPage(id, session.user_id));
});
