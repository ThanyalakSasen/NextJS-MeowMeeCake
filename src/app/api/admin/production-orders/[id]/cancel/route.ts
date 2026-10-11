/**
 * POST /api/admin/production-orders/[id]/cancel — → cancelled (production.update)
 *   body: { reason? }  ; รายการที่หักสต็อกไปแล้วจะถูกคืนสต็อก (performed_by = ผู้ทำรายการ)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as productionOrderService from "@/services/productionOrderService";
import { stockUsageLines } from "@/services/productionAudit";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const before = await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await productionOrderService.cancelProduction(id, {
    performed_by: session.user_id,
    reason: body.reason ?? undefined,
  });
  // วัตถุดิบที่คืน = stock_impact ของรายการที่หักไปแล้วก่อนยกเลิก
  auditChange(req, {
    op: "update",
    verb: "ยกเลิก",
    noun: "งานผลิต",
    entity: "ProductionOrder",
    entity_id: id,
    before: { ...before, cancelled_reason: null, stock_returned: null },
    after: {
      ...(await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined)),
      cancelled_reason: body.reason ?? null,
      stock_returned: await stockUsageLines(before?.items),
    },
    keys: ["production_status", "cancelled_reason", "stock_returned"],
  });
  return ok(result);
});
