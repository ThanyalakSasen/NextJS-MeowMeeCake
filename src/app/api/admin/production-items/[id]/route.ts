/**
 * /api/admin/production-items/[id]
 *   GET    — ดูรายการผลิตรายตัว (production.view)
 *   PATCH  — แก้ planned_qty / actual_qty / notes / item_status (production.update)
 *   DELETE — ลบ soft (production.delete ; เฉพาะรายการที่ยังไม่หักสต็อก)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as productionItemService from "@/services/productionItemService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("production", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await productionItemService.getItemById(id));
});

export const PATCH = withPermission("production", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  return ok(await productionItemService.updateItem(id, body));
});

export const DELETE = withPermission("production", "delete", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await productionItemService.deleteItem(id));
});
