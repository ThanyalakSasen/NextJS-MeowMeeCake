/**
 * POST /api/shop/preorders/[id]/cancel — ลูกค้ายกเลิกพรีออเดอร์ของตัวเอง
 *   body: { reason? }
 *   ลูกค้ายกเลิกเองได้เฉพาะสถานะ pending / confirmed (CUSTOMER_CANCELABLE_STATUSES)
 *   และเฉพาะพรีออเดอร์ที่ยังไม่ได้ชำระเงิน (payment_status != "paid") —
 *   พอร้านเริ่มเตรียม (preparing ขึ้นไป) หรือจ่ายเงินแล้ว ต้องให้แอดมินยกเลิก + คืนเงิน
 *   ผ่าน /api/admin/preorders/[id]/status + paymentService.refundPayment
 *   service คุม state machine + คืนโควตาในรอบให้อัตโนมัติ
 */
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as preorderService from "@/services/preorderService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const preorder = await preorderService.getPreorderById(id, { includeDeleted: true });
  requireOwner(session, preorder.user_id);

  const body = await req.json().catch(() => ({}));
  const result = await preorderService.cancelPreorder(id, {
    cancelled_by: session.user_id,
    cancelled_reason: body.reason ?? "ลูกค้ายกเลิกเอง",
    allowedFrom: preorderService.CUSTOMER_CANCELABLE_STATUSES,
  });
  audit(req, {
    action: "ลูกค้ายกเลิกพรีออเดอร์",
    action_type: "UPDATE",
    entity: "Preorder",
    entity_id: id,
    details: { reason: body.reason ?? null },
  });
  return ok(result);
});
