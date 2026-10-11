/**
 * POST /api/admin/production-items/[id]/reverse-stock — คืนสต็อกวัตถุดิบที่หักไป (production.approve)
 *   สร้างรายการ receive ชดเชย ; performed_by = ผู้ทำรายการ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as productionItemService from "@/services/productionItemService";
import { stockUsageLines } from "@/services/productionAudit";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "approve", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before: any = await productionItemService.getItemById(id).catch(() => undefined);
  const result = await productionItemService.reverseStock(id, { performed_by: session.user_id });
  auditChange(req, {
    op: "update",
    verb: "คืนสต็อกวัตถุดิบของ",
    noun: "รายการผลิต",
    label: (before as any)?.product_id?.product_name_th,
    entity: "ProductionItem",
    entity_id: id,
    before: { stock_returned: null },
    after: { stock_returned: await stockUsageLines(before ? [before] : []) },
    keys: ["stock_returned"],
  });
  return ok(result);
});
