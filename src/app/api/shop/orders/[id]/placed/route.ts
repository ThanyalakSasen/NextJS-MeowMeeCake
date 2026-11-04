/**
 * POST /api/shop/orders/[id]/placed — ลูกค้ากด "ชำระเงินภายหลัง" (คำสั่งซื้อ)
 *   ถึงเวลาแจ้ง "ออเดอร์ใหม่" ให้ร้าน + กระดิ่งลูกค้า (placedNoticeService — แจ้งครั้งเดียว เรียกซ้ำได้)
 *   แนบสลิปก็แจ้งแบบเดียวกันอยู่แล้ว (paymentService) — route นี้สำหรับคนที่ยังไม่โอน
 */
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import * as orderService from "@/services/orderService";
import { announcePlaced } from "@/services/placedNoticeService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const order = await orderService.getOrderById(id);
  requireOwner(session, order.user_id);
  return ok({ announced: await announcePlaced("order", id) });
});
