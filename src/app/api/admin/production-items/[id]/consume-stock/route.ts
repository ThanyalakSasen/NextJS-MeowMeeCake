/**
 * POST /api/admin/production-items/[id]/consume-stock — หักสต็อกวัตถุดิบตามสูตร (production.approve)
 *   body: { use_actual?: boolean, allowNegative?: boolean }  ; performed_by = ผู้ทำรายการ ; กันหักซ้ำ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as productionItemService from "@/services/productionItemService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "approve", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await productionItemService.consumeStock(id, {
    performed_by: session.user_id,
    use_actual: !!body.use_actual,
    allowNegative: !!body.allowNegative,
  });
  audit(req, {
    action: "หักสต็อกวัตถุดิบตามสูตร (รายการผลิต)",
    action_type: "UPDATE",
    entity: "ProductionItem",
    entity_id: id,
  });
  return ok(result);
});
