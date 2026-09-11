/**
 * PATCH /api/admin/preorders/[id]/status — เปลี่ยนสถานะพรีออเดอร์ (preorder.update)
 *   body: { order_status, cancelled_reason? }
 *   state machine: pending→confirmed→preparing→ready→completed ; cancelled ได้ทุกสถานะที่ยังไม่ completed (คืนโควตาในรอบ)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as preorderService from "@/services/preorderService";
import type { PreorderStatus } from "@/services/preorderService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("preorder", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.order_status) throw badRequest("กรุณาระบุ order_status");
  const result = await preorderService.updatePreorderStatus(id, body.order_status as PreorderStatus, {
    cancelled_by: session.user_id,
    cancelled_reason: body.cancelled_reason ?? undefined,
  });
  audit(req, {
    action: `เปลี่ยนสถานะพรีออเดอร์เป็น "${body.order_status}"`,
    action_type: "UPDATE",
    entity: "Preorder",
    entity_id: id,
    details: { order_status: body.order_status, cancelled_reason: body.cancelled_reason ?? null },
  });
  return ok(result);
});
