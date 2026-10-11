/**
 * PATCH /api/admin/preorders/[id]/status — เปลี่ยนสถานะพรีออเดอร์ (preorder.update)
 *   body: { order_status, cancelled_reason? }
 *   state machine: pending→confirmed→preparing→ready→completed ; cancelled ได้ทุกสถานะที่ยังไม่ completed (คืนโควตาในรอบ)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as preorderService from "@/services/preorderService";
import type { PreorderStatus } from "@/services/preorderService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("preorder", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.order_status) throw badRequest("กรุณาระบุ order_status");
  const before = await preorderService.getPreorderById(id).catch(() => undefined);
  const result = await preorderService.updatePreorderStatus(id, body.order_status as PreorderStatus, {
    cancelled_by: session.user_id,
    cancelled_reason: body.cancelled_reason ?? undefined,
  });
  auditChange(req, {
    op: "update",
    verb: "เปลี่ยนสถานะ",
    noun: "พรีออเดอร์",
    entity: "Preorder",
    entity_id: id,
    before,
    after: await preorderService.getPreorderById(id).catch(() => result),
    keys: ["order_status", "payment_status", "cancelled_reason"],
  });
  return ok(result);
});
