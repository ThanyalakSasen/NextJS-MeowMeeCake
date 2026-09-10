/**
 * /api/admin/payments
 *   GET  — รายการชำระเงินทั้งหมด (payments.view) — กรอง ?user_id= ?order_id= ?preorder_id= ?status= ?date_from= ?date_to=
 *   POST — สร้างรายการชำระเงินแทนลูกค้า (payments.create) — body ต้องมี user_id
 *          body: { user_id, order_id | preorder_id, amount, promptpay_ref?, slip_image_url? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import { parseBool, parsePagination } from "@/lib/queryParams";
import * as paymentService from "@/services/paymentService";
import type { PaymentStatus } from "@/services/orderService";

export const GET = withPermission("payments", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await paymentService.listPayments({
    pagination: parsePagination(sp),
    user_id: sp.get("user_id") ?? undefined,
    order_id: sp.get("order_id") ?? undefined,
    preorder_id: sp.get("preorder_id") ?? undefined,
    status: (sp.get("status") as PaymentStatus | null) ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
  });
  return ok(result);
});

export const POST = withPermission("payments", "create", async (_s, req) => {
  const body = await req.json();
  if (!body.user_id) throw badRequest("กรุณาระบุ user_id ของลูกค้า");
  return created(await paymentService.createPayment(body));
});
