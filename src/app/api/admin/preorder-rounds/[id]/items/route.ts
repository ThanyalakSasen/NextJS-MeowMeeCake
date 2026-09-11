/**
 * /api/admin/preorder-rounds/[id]/items
 *   GET  — รายการสินค้าในรอบ (preorder.view) ?activeOnly= ?includeDeleted=
 *   POST — เพิ่มสินค้าเข้ารอบ (preorder.update)
 *          body: { product_id, price_override?, min_order_qty?, max_qty_total, is_active? }
 *          product_id ต้องเป็นสินค้า product_type = "preorder"
 */
import { okList, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import * as preorderRoundService from "@/services/preorderRoundService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("preorder", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const items = await preorderRoundService.listRoundItems(id, {
    activeOnly: parseBool(sp.get("activeOnly")) ?? false,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
  });
  return okList(items);
});

export const POST = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const item: any = await preorderRoundService.addRoundItem(id, {
    product_id: body.product_id,
    price_override: body.price_override ?? null,
    min_order_qty: body.min_order_qty,
    max_qty_total: body.max_qty_total,
    is_active: body.is_active,
  });
  audit(req, {
    action: "เพิ่มสินค้าเข้ารอบพรีออเดอร์",
    action_type: "UPDATE",
    entity: "PreorderRound",
    entity_id: id,
    details: { round_item_id: item?._id ? String(item._id) : null, product_id: body.product_id },
  });
  return created(item);
});
