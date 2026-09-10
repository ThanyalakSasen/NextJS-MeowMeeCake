/**
 * /api/shop/payments  (การชำระเงินของผู้ใช้ที่ล็อกอินเท่านั้น)
 *   GET  — รายการชำระเงินของตัวเอง (?order_id=&preorder_id=&status=&page=&limit=)
 *   POST — แจ้งชำระเงินของตัวเอง (สถานะเริ่ม pending) — ตรวจด้วย schemas/payment.createPaymentBody
 *          body: { order_id | preorder_id, amount, promptpay_ref?, slip_image_url? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
import { parseBody, parseQuery } from "@/lib/validate";
import { createPaymentBody, listPaymentQuery } from "@/schemas/payment";
import * as paymentService from "@/services/paymentService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  const q = parseQuery(sp, listPaymentQuery);
  const result = await paymentService.listPayments({
    pagination: parsePagination(sp),
    user_id: session.user_id, // ของตัวเองเท่านั้น
    order_id: q.order_id,
    preorder_id: q.preorder_id,
    status: q.status,
  });
  return ok(result);
});

export const POST = withAuth(async (session, req) => {
  const body = await parseBody(req, createPaymentBody);
  return created(
    await paymentService.createPayment({
      user_id: session.user_id,
      order_id: body.order_id ?? null,
      preorder_id: body.preorder_id ?? null,
      amount: body.amount,
      promptpay_ref: body.promptpay_ref ?? null,
      slip_image_url: body.slip_image_url ?? null,
    })
  );
});
