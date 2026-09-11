/**
 * PATCH /api/shop/payments/[id]/slip — ลูกค้าแนบ/แก้สลิปโอนเงินของตัวเอง
 *   body: { slip_image_url, promptpay_ref? }  — ตรวจด้วย schemas/payment.submitSlipBody
 *   สถานะกลับมา pending รอแอดมินตรวจ
 */
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import { parseBody, parse } from "@/lib/validate";
import { submitSlipBody } from "@/schemas/payment";
import { objectId } from "@/schemas/common";
import * as paymentService from "@/services/paymentService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req, ctx: Ctx) => {
  const id = parse((await ctx.params).id, objectId, "id ของรายการชำระเงิน");
  const payment = await paymentService.getPaymentById(id);
  requireOwner(session, (payment as { user_id?: unknown }).user_id);

  const body = await parseBody(req, submitSlipBody);
  return ok(
    await paymentService.submitSlip(id, {
      slip_image_url: body.slip_image_url,
      promptpay_ref: body.promptpay_ref ?? undefined,
    })
  );
});
