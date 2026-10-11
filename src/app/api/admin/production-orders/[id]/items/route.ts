/**
 * /api/admin/production-orders/[id]/items
 *   GET  — รายการผลิตในใบสั่งผลิต (production.view)
 *   POST — เพิ่มรายการผลิต (production.update)  body: { product_id, recipe_id, planned_qty, round_item_id?, notes? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as productionItemService from "@/services/productionItemService";
import * as productionOrderService from "@/services/productionOrderService";
import { auditChange } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("production", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await productionItemService.listByOrder(id));
});

export const POST = withPermission("production", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const item: any = await productionItemService.addItem(id, body);
  const full = item?._id ? await productionItemService.getItemById(String(item._id)).catch(() => undefined) : undefined;
  const order: any = await productionOrderService.getProductionOrderById(id, { includeDeleted: true }).catch(() => undefined);
  auditChange(req, {
    op: "create",
    verb: "เพิ่ม",
    noun: "รายการผลิต",
    label: (full as any)?.product_id?.product_name_th,
    suffix: order?.production_no ? ` ในใบ "${order.production_no}"` : "",
    entity: "ProductionItem",
    entity_id: item?._id ? String(item._id) : null,
    after: full ?? item,
    keys: ["recipe_id", "planned_qty", "notes"],
  });
  return created(item);
});
