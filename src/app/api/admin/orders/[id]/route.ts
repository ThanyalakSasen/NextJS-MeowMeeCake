/**
 * /api/admin/orders/[id]
 *   GET    — ออเดอร์ + รายการสินค้า (orders.view) + refund_account (บัญชีพร้อมเพย์ของลูกค้า เฉพาะตอนรอโอนคืน)
 *   DELETE — ลบออเดอร์ soft (orders.delete ; เฉพาะออเดอร์ที่ completed/cancelled)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import * as orderService from "@/services/orderService";
import { withRefundAccount } from "@/services/userService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("orders", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await withRefundAccount(await orderService.getOrderById(id, { includeDeleted })));
});

export const DELETE = withPermission("orders", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before = await orderService.getOrderById(id).catch(() => undefined);
  const result = await orderService.deleteOrder(id);
  auditChange(req, {
    op: "delete",
    noun: "ออเดอร์",
    entity: "Order",
    entity_id: id,
    before,
    keys: ["order_status", "payment_status", "total_amount"],
  });
  return ok(result);
});
