/** GET /api/admin/orders/by-no/[orderNo] — ค้นออเดอร์ด้วยเลขออเดอร์ (orders.view) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as orderService from "@/services/orderService";

type Ctx = { params: Promise<{ orderNo: string }> };

export const GET = withPermission("orders", "view", async (_s, _r, ctx: Ctx) => {
  const { orderNo } = await ctx.params;
  return ok(await orderService.getOrderByNo(decodeURIComponent(orderNo)));
});
