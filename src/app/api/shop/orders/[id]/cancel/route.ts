/**
 * POST /api/shop/orders/[id]/cancel — ลูกค้ายกเลิกออเดอร์ของตัวเอง
 *   body: { reason? }
 *   ลูกค้ายกเลิกเองได้เฉพาะสถานะ pending / confirmed (CUSTOMER_CANCELABLE_STATUSES) —
 *   พอร้านเริ่มเตรียม (preparing ขึ้นไป) ต้องให้แอดมินยกเลิกผ่าน /api/admin/orders/[id]/status
 *   service คืนสต็อก + คืนสิทธิ์โปรโมชันให้อัตโนมัติ
 */
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as orderService from "@/services/orderService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const order = await orderService.getOrderById(id, { includeDeleted: true });
  requireOwner(session, order.user_id);

  const body = await req.json().catch(() => ({}));
  const result = await orderService.cancelOrder(id, {
    cancelled_by: session.user_id,
    cancelled_reason: body.reason ?? "ลูกค้ายกเลิกเอง",
    allowedFrom: orderService.CUSTOMER_CANCELABLE_STATUSES,
  });
  audit(req, {
    action: "ลูกค้ายกเลิกออเดอร์",
    action_type: "UPDATE",
    entity: "Order",
    entity_id: id,
    details: { reason: body.reason ?? null },
  });
  return ok(result);
});
