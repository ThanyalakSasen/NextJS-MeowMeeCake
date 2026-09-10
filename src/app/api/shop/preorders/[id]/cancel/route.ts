/**
 * POST /api/shop/preorders/[id]/cancel — ลูกค้ายกเลิกพรีออเดอร์ของตัวเอง
 *   body: { reason? }
 *   service คุม state machine (ยกเลิกได้เฉพาะที่ยังไม่ completed) + คืนโควตาในรอบให้อัตโนมัติ
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
