/**
 * /api/admin/production-items/[id]
 *   GET    — ดูรายการผลิตรายตัว (production.view)
 *   PATCH  — แก้ planned_qty / actual_qty / notes / item_status (production.update)
 *   DELETE — ลบ soft (production.delete ; เฉพาะรายการที่ยังไม่หักสต็อก)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as productionItemService from "@/services/productionItemService";
import { auditChange } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("production", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await productionItemService.getItemById(id));
});

export const PATCH = withPermission("production", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const keys = Object.keys(body ?? {});
  const before = await productionItemService.getItemById(id).catch(() => undefined);
  const result = await productionItemService.updateItem(id, body);
  const after = await productionItemService.getItemById(id).catch(() => undefined);
  auditChange(req, {
    op: "update",
    noun: "รายการผลิต",
    label: (after ?? before as any)?.product_id?.product_name_th,
    entity: "ProductionItem",
    entity_id: id,
    before,
    after: after ?? result,
    keys,
  });
  return ok(result);
});

export const DELETE = withPermission("production", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before = await productionItemService.getItemById(id).catch(() => undefined);
  const result = await productionItemService.deleteItem(id);
  auditChange(req, {
    op: "delete",
    noun: "รายการผลิต",
    label: (before as any)?.product_id?.product_name_th,
    entity: "ProductionItem",
    entity_id: id,
    before,
    keys: ["planned_qty", "item_status"],
  });
  return ok(result);
});
