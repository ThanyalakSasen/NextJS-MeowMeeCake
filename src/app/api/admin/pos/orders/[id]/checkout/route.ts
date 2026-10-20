/**
 * POST /api/admin/pos/orders/[id]/checkout — รับเงินที่เคาน์เตอร์ + ปิดออเดอร์หน้าร้าน (orders.create)
 *   สร้างรายการชำระ → ยืนยันจ่ายทันที (verified_by = ผู้ขาย) → completed
 *   พนักงานที่ขายที่ POS ได้ = อนุมัติการชำระของออเดอร์หน้าร้านได้อัตโนมัติ ไม่ต้องมี payments.approve
 *   ใช้ได้เฉพาะออเดอร์เลข POS- (ดู services/posCheckoutService.ts)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as paymentService from "@/services/paymentService";
import { checkoutPosOrder } from "@/services/posCheckoutService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("orders", "create", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await checkoutPosOrder(id, session.user_id);
  auditChange(req, {
    op: "update",
    verb: "รับเงินหน้าร้าน",
    noun: "การชำระเงินของ",
    label: await paymentService.paymentDocNo(result.payment),
    entity: "Payment",
    entity_id: String(result.payment._id),
    after: result.payment,
    keys: ["status", "amount"],
  });
  return ok(result);
});
