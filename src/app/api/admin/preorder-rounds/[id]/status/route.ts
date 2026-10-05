/**
 * PATCH /api/admin/preorder-rounds/[id]/status — เปลี่ยนสถานะรอบ (preorder.update)
 *   body: { round_status: "scheduled"|"open"|"closed"|"cancelled", close_date? }
 *   state machine: scheduled→open→closed ; scheduled|open→cancelled ; closed→open (ยังไม่มีใบสั่งผลิต — ส่ง close_date ใหม่ได้)
 *   closed → ยกเลิกคนไม่จ่าย + สร้างใบสั่งผลิตอัตโนมัติ · response มี close_result { unpaid, production }
 *   (ปกติรอบเปิด/ปิดเองตามเวลาผ่าน /api/cron/preorder-rounds — docs/preorder-round-flow.md §6)
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
    close_date: body.close_date ?? undefined,
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
      ...(round?.close_result
        ? {
            unpaid_cancelled: round.close_result.unpaid.cancelled.length,
            production_no: round.close_result.production.production_no ?? null,
          }
        : {}),
    },
  });
  return ok(round);
});
