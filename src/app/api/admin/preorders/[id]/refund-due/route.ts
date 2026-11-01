/**
 * POST /api/admin/preorders/[id]/refund-due — ยืนยันว่าโอนเงินคืนบางส่วนแล้ว (payments.delete — สิทธิ์เดียวกับคืนเงินเต็มใบ)
 *   refund_due_amount → refund_done_amount · ยอดเกิดจาก POST /admin/preorder-round-items/[id]/cancel
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { markRefundDone } from "@/services/preorderItemCancelService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("payments", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await markRefundDone(id);
  auditChange(req, {
    op: "update",
    verb: "คืนเงิน",
    noun: "ของ",
    label: result.preorder_no,
    entity: "Preorder",
    entity_id: id,
    after: result,
    keys: ["refund_done_amount"],
  });
  return ok({ _id: result._id, refund_due_amount: result.refund_due_amount, refund_done_amount: result.refund_done_amount });
});
