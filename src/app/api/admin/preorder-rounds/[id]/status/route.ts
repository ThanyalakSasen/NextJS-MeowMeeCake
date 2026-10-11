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
import { auditChange } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as preorderRoundService from "@/services/preorderRoundService";
import type { RoundStatus } from "@/services/preorderRoundService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("preorder", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.round_status) throw badRequest("กรุณาระบุ round_status");
  const before = await preorderRoundService.getRoundById(id, { includeDeleted: true }).catch(() => undefined);
  const round: any = await preorderRoundService.updateRoundStatus(id, body.round_status as RoundStatus, {
    by: session.user_id,
    close_date: body.close_date ?? undefined,
  });
  // ผลพ่วงของการเปลี่ยนสถานะ (ยกเลิกพรีออเดอร์ที่ค้าง / ใบสั่งผลิตที่สร้างตอนปิดรอบ) เป็นฟิลด์ฝั่ง "หลัง"
  const effects = {
    cancelled_preorders: round?.cancel_cascade?.cancelled?.length ?? null,
    unpaid_cancelled: round?.close_result?.unpaid?.cancelled?.length ?? null,
    production_no: round?.close_result?.production?.production_no ?? null,
  };
  auditChange(req, {
    op: "update",
    verb: "เปลี่ยนสถานะ",
    noun: "รอบพรีออเดอร์",
    entity: "PreorderRound",
    entity_id: id,
    before,
    after: { ...(await preorderRoundService.getRoundById(id, { includeDeleted: true }).catch(() => undefined) ?? round), ...effects },
    keys: ["round_status", "close_date", ...Object.keys(effects)],
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
