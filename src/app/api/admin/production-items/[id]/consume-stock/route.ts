/**
 * POST /api/admin/production-items/[id]/consume-stock — หักสต็อกวัตถุดิบตามสูตร (production.approve)
 *   body: { use_actual?: boolean, allowNegative?: boolean }  ; performed_by = ผู้ทำรายการ ; กันหักซ้ำ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as productionItemService from "@/services/productionItemService";
import { stockUsageLines } from "@/services/productionAudit";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "approve", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await productionItemService.consumeStock(id, {
    performed_by: session.user_id,
    use_actual: !!body.use_actual,
    allowNegative: !!body.allowNegative,
  });
  const item: any = await productionItemService.getItemById(id).catch(() => undefined);
  auditChange(req, {
    op: "update",
    verb: "หักสต็อกวัตถุดิบของ",
    noun: "รายการผลิต",
    label: (item as any)?.product_id?.product_name_th,
    entity: "ProductionItem",
    entity_id: id,
    before: { stock_used: null },
    after: { stock_used: await stockUsageLines(item ? [item] : [result as any]) },
    keys: ["stock_used"],
  });
  return ok(result);
});
