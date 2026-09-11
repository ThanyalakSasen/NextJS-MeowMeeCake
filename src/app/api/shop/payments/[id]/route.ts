/** GET /api/shop/payments/[id] — ดูรายการชำระเงินของตัวเอง */
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import * as paymentService from "@/services/paymentService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const payment = await paymentService.getPaymentById(id);
  requireOwner(session, (payment as { user_id?: unknown }).user_id);
  return ok(payment);
});
