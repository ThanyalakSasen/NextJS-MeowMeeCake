/** GET /api/admin/orders/[id]/items — รายการสินค้าในออเดอร์ (orders.view) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as orderItemService from "@/services/orderItemService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("orders", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await orderItemService.listByOrder(id));
});
