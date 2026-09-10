/**
 * /api/admin/payments/[id]
 *   GET    — ดูรายการชำระเงินรายตัว (payments.view)
 *   DELETE — ลบ soft (payments.delete ; ลบรายการ paid ไม่ได้ ให้ใช้ refund)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as paymentService from "@/services/paymentService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("payments", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await paymentService.getPaymentById(id));
});

export const DELETE = withPermission("payments", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await paymentService.deletePayment(id);
  audit(req, { action: "ลบรายการชำระเงิน", action_type: "DELETE", entity: "Payment", entity_id: id });
  return ok(result);
});
