/**
 * POST /api/admin/payments/[id]/refund — คืนเงิน (payments.approve)
 *   paid → refunded + อัปเดต payment_status ของ order/preorder ; verified_by = ผู้ทำรายการ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as paymentService from "@/services/paymentService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("payments", "approve", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await paymentService.refundPayment(id, { verified_by: session.user_id });
  audit(req, {
    action: "คืนเงิน",
    action_type: "UPDATE",
    entity: "Payment",
    entity_id: id,
  });
  return ok(result);
});
