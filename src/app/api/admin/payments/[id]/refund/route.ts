/**
 * POST /api/admin/payments/[id]/refund — คืนเงิน (payments.delete)
 *   ไม่ใช้ payments.approve — พนักงานเคาน์เตอร์ที่ยืนยันสลิปใน POS ได้ จะได้ไม่กดคืนเงินได้ไปด้วย (Final-Backlog P7)
 *   payments.delete = งานเงินที่ย้อนกลับไม่ได้ (ลบรายการชำระ · คืนเงิน) — ให้เฉพาะคนที่ไว้ใจ
 *   paid → refunded + อัปเดต payment_status ของ order/preorder ; verified_by = ผู้ทำรายการ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as paymentService from "@/services/paymentService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("payments", "delete", async (session, req, ctx: Ctx) => {
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
