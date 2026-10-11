/** POST /api/admin/production-orders/[id]/start — planned → in_progress (production.update) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as productionOrderService from "@/services/productionOrderService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before = await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await productionOrderService.startProduction(id);
  auditChange(req, {
    op: "update",
    verb: "เริ่ม",
    noun: "งานผลิต",
    entity: "ProductionOrder",
    entity_id: id,
    before,
    after: await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined),
    keys: ["production_status", "started_at"],
  });
  return ok(result);
});
