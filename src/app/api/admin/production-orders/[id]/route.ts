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

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("production", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await productionOrderService.getProductionOrderById(id, { includeDeleted }));
});

export const PATCH = withPermission("production", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  return ok(await productionOrderService.updateProductionOrder(id, body));
});

export const DELETE = withPermission("production", "delete", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await productionOrderService.deleteProductionOrder(id));
});
