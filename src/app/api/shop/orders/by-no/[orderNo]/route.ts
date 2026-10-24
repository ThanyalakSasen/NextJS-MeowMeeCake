/** GET /api/shop/orders/by-no/[orderNo] — ค้นออเดอร์ของตัวเองด้วยเลขออเดอร์ (เช่น ORD-20261024-MMC001) */
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import * as orderService from "@/services/orderService";

type Ctx = { params: Promise<{ orderNo: string }> };

export const GET = withAuth(async (session, _req, ctx: Ctx) => {
  const { orderNo } = await ctx.params;
  const order = await orderService.getOrderByNo(decodeURIComponent(orderNo));
  requireOwner(session, order.user_id);
  return ok(order);
});
