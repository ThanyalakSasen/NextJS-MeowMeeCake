/** GET /api/shop/orders/[id] — ออเดอร์ + รายการสินค้า (เฉพาะเจ้าของ) · เลยกำหนดชำระแล้วยกเลิกก่อนแสดง (lazy) */
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import * as orderService from "@/services/orderService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const order = await orderService.getOrderById(id);
  requireOwner(session, order.user_id);
  // หมดเวลาชำระ 30 นาที — ยกเลิกให้เห็นสถานะล่าสุด (cron ทำทุก 5 นาทีอยู่แล้ว · docs/customer-backend-merge.md §8.8)
  const { expired } = await orderService.expireUnpaidOrders({ userId: session.user_id, orderId: id });
  return ok(expired.length ? await orderService.getOrderById(id) : order);
});
