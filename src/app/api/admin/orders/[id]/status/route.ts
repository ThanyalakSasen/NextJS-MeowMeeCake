/**
 * PATCH /api/admin/orders/[id]/status — เปลี่ยนสถานะออเดอร์ (orders.update)
 *   body: { order_status, cancelled_reason? }
 *   state machine: pending→confirmed→preparing→ready→completed ; cancelled ได้ทุกสถานะที่ยังไม่ completed
 *   ตอน cancelled: คืนสต็อก + คืนสิทธิ์โปรโมชัน + ถ้า payment_status = "paid" → คืนเงินอัตโนมัติ
 *   (refundPayment โดยใช้ session.user_id เป็นผู้ดำเนินการ) — best-effort, ดู BACKLOG 2.8
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as orderService from "@/services/orderService";
import type { OrderStatus } from "@/services/orderService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("orders", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.order_status) throw badRequest("กรุณาระบุ order_status");
  const result = await orderService.updateOrderStatus(id, body.order_status as OrderStatus, {
    cancelled_by: session.user_id,
    cancelled_reason: body.cancelled_reason ?? undefined,
  });
  audit(req, {
    action: `เปลี่ยนสถานะออเดอร์เป็น "${body.order_status}"`,
    action_type: "UPDATE",
    entity: "Order",
    entity_id: id,
    details: { order_status: body.order_status, cancelled_reason: body.cancelled_reason ?? null },
  });
  return ok(result);
});
