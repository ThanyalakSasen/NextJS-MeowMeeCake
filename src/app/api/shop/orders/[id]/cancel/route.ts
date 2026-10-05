/**
 * POST /api/shop/orders/[id]/cancel — ลูกค้ายกเลิกออเดอร์ของตัวเอง
 *   body: { reason? }
 *   นโยบายฝั่งลูกค้า (docs/customer-backend-merge.md §8.8 — orderService.cancelOrderByCustomer):
 *   - ยกเลิกเองได้เฉพาะสถานะ pending / confirmed · ออเดอร์หน้าร้าน (POS-) ยกเลิกผ่านร้านเท่านั้น
 *   - ชำระแล้วก็ยกเลิกได้ → "ยกเลิก + ชำระแล้ว" = รอร้านโอนคืน (ไม่ตั้ง refunded ให้อัตโนมัติ) + แจ้งเจ้าของร้าน
 *     ร้านโอนคืนแล้วกดคืนเงินเอง (POST /api/admin/payments/[id]/refund)
 *   - คืนสต็อก + คืนสิทธิ์โปรโมชันให้อัตโนมัติ
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
  const result = await orderService.cancelOrderByCustomer(id, session.user_id, body.reason ?? null);
  audit(req, {
    action: "ลูกค้ายกเลิกออเดอร์",
    action_type: "UPDATE",
    entity: "Order",
    entity_id: id,
    details: { reason: body.reason ?? null },
  });
  return ok(result);
});
