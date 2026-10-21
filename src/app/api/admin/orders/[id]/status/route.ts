/**
 * PATCH /api/admin/orders/[id]/status — เปลี่ยนสถานะออเดอร์ (orders.update)
 *   body: { order_status, cancelled_reason? }
 *   state machine: pending→confirmed→preparing→ready→completed ; cancelled ได้ทุกสถานะที่ยังไม่ completed
 *   ตอน cancelled: คืนสต็อก + คืนสิทธิ์โปรโมชัน · ถ้าชำระแล้ว **ไม่** ตั้ง payment เป็น refunded ให้ —
 *   ออเดอร์เป็น "ยกเลิก + ชำระแล้ว" = รอโอนคืน แล้วร้านกดยืนยันหลังโอนจริง (POST /api/admin/payments/[id]/refund)
 *   เหมือนตอนลูกค้ายกเลิกเอง — เดิมคืนอัตโนมัติทันทีทั้งที่ยังไม่ได้โอน (Test case TC-ADM-42)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as orderService from "@/services/orderService";
import type { OrderStatus } from "@/services/orderService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("orders", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.order_status) throw badRequest("กรุณาระบุ order_status");
  const before = await orderService.getOrderById(id).catch(() => undefined);
  const result = await orderService.updateOrderStatus(id, body.order_status as OrderStatus, {
    cancelled_by: session.user_id,
    cancelled_reason: body.cancelled_reason ?? undefined,
    skipAutoRefund: true,
  });
  auditChange(req, {
    op: "update",
    verb: "เปลี่ยนสถานะ",
    noun: "ออเดอร์",
    entity: "Order",
    entity_id: id,
    before,
    after: await orderService.getOrderById(id).catch(() => result),
    keys: ["order_status", "payment_status", "cancelled_reason"],
  });
  return ok(result);
});
