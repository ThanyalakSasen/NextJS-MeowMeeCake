/**
 * /api/admin/production-orders/[id]
 *   GET    — ใบสั่งผลิต + รายการผลิต (production.view)
 *   PATCH  — แก้ production_date / assigned_to / production_note (production.update)
 *   DELETE — ลบ soft (production.delete ; เฉพาะที่ done/cancelled)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseBool } from "@/lib/queryParams";
import * as productionOrderService from "@/services/productionOrderService";
import { auditChange } from "@/lib/audit";
import { orderForAudit } from "@/services/productionAudit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("production", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await productionOrderService.getProductionOrderById(id, { includeDeleted }));
});

export const PATCH = withPermission("production", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const keys = Object.keys(body ?? {});
  const before = await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await productionOrderService.updateProductionOrder(id, body);
  auditChange(req, {
    op: "update",
    noun: "ใบสั่งผลิต",
    entity: "ProductionOrder",
    entity_id: id,
    before: orderForAudit(before),
    after: orderForAudit(result as any),
    keys,
  });
  return ok(result);
});

export const DELETE = withPermission("production", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before = await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await productionOrderService.deleteProductionOrder(id);
  auditChange(req, {
    op: "delete",
    noun: "ใบสั่งผลิต",
    entity: "ProductionOrder",
    entity_id: id,
    before: orderForAudit(before),
    keys: ["production_status", "production_date", "items_summary"],
  });
  return ok(result);
});
