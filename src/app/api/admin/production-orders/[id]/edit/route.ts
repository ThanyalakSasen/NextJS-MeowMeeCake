/**
 * PUT /api/admin/production-orders/[id]/edit — บันทึกใบสั่งผลิตทั้งใบในคำขอเดียว (production.update · มีลบรายการต้อง production.delete ด้วย)
 *   body: { production_date?, assigned_to?, production_note?, items?: { remove: [item_id], update: [{ item_id, planned_qty, notes }], add: [{ product_id, recipe_id, planned_qty, notes }] } }
 *   เอกสารบั๊กข้อ 12 — เดิมหน้าเว็บยิง PATCH หัวใบ + DELETE/PATCH/POST ทีละรายการ ล้มกลางทาง = ใบเหลือครึ่ง ๆ กลาง ๆ
 *   ตรวจทุกอย่างก่อน แล้วเขียนรวดเดียว (transaction บน replica set)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission, requirePermission } from "@/lib/authGuard";
import { parseBody } from "@/lib/validate";
import { auditChange } from "@/lib/audit";
import { productionOrderEditBody } from "@/schemas/production";
import * as productionOrderService from "@/services/productionOrderService";
import { orderForAudit } from "@/services/productionAudit";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withPermission("production", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, productionOrderEditBody);
  if (body.items?.remove.length) await requirePermission(session, "production", "delete");
  const before = await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await productionOrderService.saveProductionOrderEdit(id, body);
  auditChange(req, {
    op: "update",
    noun: "ใบสั่งผลิต",
    entity: "ProductionOrder",
    entity_id: id,
    before: orderForAudit(before),
    after: orderForAudit(result as any),
    keys: [...Object.keys(body).filter((k) => k !== "items"), ...(body.items ? ["items_summary"] : [])],
  });
  return ok(result);
});
