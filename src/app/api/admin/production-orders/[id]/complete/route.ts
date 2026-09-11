/**
 * POST /api/admin/production-orders/[id]/complete — in_progress → done (production.approve)
 *   body: { use_actual?: boolean, allowNegative?: boolean }  ; performed_by = ผู้ทำรายการ
 *   หักสต็อกวัตถุดิบของรายการที่ยังไม่ถูกหักให้ครบ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as productionOrderService from "@/services/productionOrderService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "approve", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await productionOrderService.completeProduction(id, {
    performed_by: session.user_id,
    use_actual: !!body.use_actual,
    allowNegative: !!body.allowNegative,
  });
  audit(req, {
    action: "ปิดงานผลิต (หักสต็อกวัตถุดิบ)",
    action_type: "UPDATE",
    entity: "ProductionOrder",
    entity_id: id,
    details: { use_actual: !!body.use_actual, allowNegative: !!body.allowNegative },
  });
  return ok(result);
});
