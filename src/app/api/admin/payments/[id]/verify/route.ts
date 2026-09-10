/**
 * POST /api/admin/payments/[id]/verify — ตรวจสลิป (payments.approve)
 *   body: { approved: boolean }  — true → "paid", false → "failed" ; verified_by = ผู้ตรวจสอบ
 *   อัปเดต payment_status ของ order/preorder ให้อัตโนมัติ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as paymentService from "@/services/paymentService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("payments", "approve", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (typeof body.approved !== "boolean") throw badRequest("approved ต้องเป็น true หรือ false");
  const result = await paymentService.verifyPayment(id, {
    verified_by: session.user_id,
    approved: body.approved,
  });
  audit(req, {
    action: body.approved ? "อนุมัติการชำระเงิน" : "ปฏิเสธการชำระเงิน",
    action_type: "UPDATE",
    entity: "Payment",
    entity_id: id,
    details: { approved: body.approved },
  });
  return ok(result);
});
