/** GET /api/shop/orders/[id] — ออเดอร์ + รายการสินค้า (เฉพาะเจ้าของ) */
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import * as orderService from "@/services/orderService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const order = await orderService.getOrderById(id);
  requireOwner(session, order.user_id);
  return ok(order);
});
