/**
 * PATCH /api/admin/preorder-rounds/[id]/status — เปลี่ยนสถานะรอบ (preorder.update)
 *   body: { round_status: "scheduled"|"open"|"closed"|"cancelled" }
 *   state machine: scheduled→open→closed ; scheduled|open→cancelled
 *   cancelled → ยกเลิกพรีออเดอร์ที่ค้างในรอบให้ด้วย (คืนโควตา/คืนเงิน/แจ้ง LINE) · response มี cancel_cascade { cancelled, failed }
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as preorderRoundService from "@/services/preorderRoundService";
import type { RoundStatus } from "@/services/preorderRoundService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("preorder", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.round_status) throw badRequest("กรุณาระบุ round_status");
  const round: any = await preorderRoundService.updateRoundStatus(id, body.round_status as RoundStatus, {
    by: session.user_id,
  });
  audit(req, {
    action: `เปลี่ยนสถานะรอบพรีออเดอร์เป็น "${body.round_status}"`,
    action_type: "UPDATE",
    entity: "PreorderRound",
    entity_id: id,
    details: {
      round_status: body.round_status,
      // ยกเลิกรอบ → ยกเลิกพรีออเดอร์ที่ค้างให้ด้วย (docs/preorder-round-flow.md ปัญหา 1)
      ...(round?.cancel_cascade
        ? {
            cancelled_preorders: round.cancel_cascade.cancelled.length,
            failed_preorders: round.cancel_cascade.failed.length,
          }
        : {}),
    },
  });
  return ok(round);
});
