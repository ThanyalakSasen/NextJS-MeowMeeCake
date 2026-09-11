/**
 * /api/admin/order-items/[id]
 *   GET   — ดูรายการสินค้าในออเดอร์รายตัว (orders.view)
 *   PATCH — แก้หมายเหตุ body: { special_request } (orders.update ; แก้ไม่ได้ถ้าออเดอร์ปิดแล้ว)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as orderItemService from "@/services/orderItemService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("orders", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await orderItemService.getOrderItemById(id));
});

export const PATCH = withPermission("orders", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  return ok(await orderItemService.updateSpecialRequest(id, body.special_request ?? null));
});
