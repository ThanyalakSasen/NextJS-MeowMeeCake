/** POST /api/admin/production-orders/[id]/start — planned → in_progress (production.update) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as productionOrderService from "@/services/productionOrderService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await productionOrderService.startProduction(id);
  audit(req, {
    action: "เริ่มงานผลิต",
    action_type: "UPDATE",
    entity: "ProductionOrder",
    entity_id: id,
  });
  return ok(result);
});
