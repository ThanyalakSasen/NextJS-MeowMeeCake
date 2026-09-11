/**
 * /api/admin/orders/[id]
 *   GET    — ออเดอร์ + รายการสินค้า (orders.view)
 *   DELETE — ลบออเดอร์ soft (orders.delete ; เฉพาะออเดอร์ที่ completed/cancelled)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import * as orderService from "@/services/orderService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("orders", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await orderService.getOrderById(id, { includeDeleted }));
});

export const DELETE = withPermission("orders", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await orderService.deleteOrder(id);
  audit(req, { action: "ลบออเดอร์", action_type: "DELETE", entity: "Order", entity_id: id });
  return ok(result);
});
