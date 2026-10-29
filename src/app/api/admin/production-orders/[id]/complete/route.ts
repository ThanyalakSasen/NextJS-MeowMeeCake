/**
 * POST /api/admin/production-orders/[id]/complete — in_progress → done (production.approve)
 *   body: { use_actual?: boolean, allowNegative?: boolean,
 *           lots?: [{ item_id, produced_date?: "YYYY-MM-DD", expiry_date?: "YYYY-MM-DD" | null }],
 *           actuals?: [{ item_id, actual_qty }] }  ; performed_by = ผู้ทำรายการ
 *   actuals = จำนวนที่ผลิตได้จริง บันทึกพร้อมปิดงาน (0 = ยกเลิกรายการ) — ทั้งใบสำเร็จหรือไม่เปลี่ยนอะไรเลย
 *   หักสต็อกวัตถุดิบของรายการที่ยังไม่ถูกหักให้ครบ + สร้างล็อตสินค้า (วันผลิต/วันหมดอายุ — productLotService)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as productionOrderService from "@/services/productionOrderService";
import { orderForAudit, stockUsageLines } from "@/services/productionAudit";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "approve", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const before = await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await productionOrderService.completeProduction(id, {
    performed_by: session.user_id,
    use_actual: !!body.use_actual,
    allowNegative: !!body.allowNegative,
    lots: body.lots,
    actuals: body.actuals,
  });
  // วัตถุดิบที่ถูกหักรอบนี้ = stock_impact หลังปิด ลบที่หักไว้แล้วก่อนหน้า (รายการที่หักแยกไปก่อน)
  const after: any = await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined);
  const consumedBefore = new Set(
    (before?.items ?? []).filter((it: any) => it.stock_impact?.length).map((it: any) => String(it._id)),
  );
  const newlyConsumed = (after?.items ?? []).filter((it: any) => !consumedBefore.has(String(it._id)));
  auditChange(req, {
    op: "update",
    verb: "ปิด",
    noun: "งานผลิต",
    entity: "ProductionOrder",
    entity_id: id,
    before: { ...orderForAudit(before), stock_used: null },
    after: { ...orderForAudit(after), stock_used: await stockUsageLines(newlyConsumed) },
    keys: ["production_status", "completed_at", "items_summary", "stock_used"],
    details: { use_actual: !!body.use_actual, allowNegative: !!body.allowNegative },
  });
  return ok(result);
});
