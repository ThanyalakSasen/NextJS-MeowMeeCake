/**
 * POST /api/admin/production-orders/[id]/cancel — → cancelled (production.update)
 *   body: { reason? }  ; รายการที่หักสต็อกไปแล้วจะถูกคืนสต็อก (performed_by = ผู้ทำรายการ)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as productionOrderService from "@/services/productionOrderService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await productionOrderService.cancelProduction(id, {
    performed_by: session.user_id,
    reason: body.reason ?? undefined,
  });
  audit(req, {
    action: "ยกเลิกงานผลิต (คืนสต็อกวัตถุดิบ)",
    action_type: "UPDATE",
    entity: "ProductionOrder",
    entity_id: id,
    details: { reason: body.reason ?? null },
  });
  return ok(result);
});
