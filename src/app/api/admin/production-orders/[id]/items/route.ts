/**
 * /api/admin/production-orders/[id]/items
 *   GET  — รายการผลิตในใบสั่งผลิต (production.view)
 *   POST — เพิ่มรายการผลิต (production.update)  body: { product_id, recipe_id, planned_qty, round_item_id?, notes? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as productionItemService from "@/services/productionItemService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("production", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await productionItemService.listByOrder(id));
});

export const POST = withPermission("production", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  return created(await productionItemService.addItem(id, body));
});
