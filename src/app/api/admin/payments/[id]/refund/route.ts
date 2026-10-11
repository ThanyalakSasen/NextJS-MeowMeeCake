/**
 * POST /api/admin/payments/[id]/refund — คืนเงิน (payments.approve)
 *   paid → refunded + อัปเดต payment_status ของ order/preorder ; verified_by = ผู้ทำรายการ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as paymentService from "@/services/paymentService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("payments", "approve", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before = await paymentService.getPaymentById(id).catch(() => undefined);
  const result = await paymentService.refundPayment(id, { verified_by: session.user_id });
  auditChange(req, {
    op: "update",
    verb: "คืนเงิน",
    noun: "ของ",
    label: await paymentService.paymentDocNo(result),
    entity: "Payment",
    entity_id: id,
    before,
    after: result,
    keys: ["status", "amount"],
  });
  return ok(result);
});
