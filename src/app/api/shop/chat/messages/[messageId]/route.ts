/**
 * PATCH  /api/shop/chat/messages/:messageId — ลูกค้าแก้ข้อความของตัวเอง body: { body, order_id? | preorder_id? } (≤1000 · มีแนบคำสั่งซื้อ = ว่างได้ · ส่ง order_id/preorder_id = เปลี่ยนคำสั่งซื้อที่แนบ)
 * DELETE /api/shop/chat/messages/:messageId — ลูกค้าลบข้อความของตัวเอง (soft delete — ร้านเห็น "ข้อความนี้ถูกลบแล้ว")
 * ข้อความของร้าน / ของคนอื่น / ลบไปแล้ว = 404 · คืนข้อความหลังแก้/ลบ
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ messageId: string }> };

export const PATCH = withAuth(async (session, req, ctx: Ctx) => {
  const { messageId } = await ctx.params;
  return ok(await chatService.editCustomerMessage(session.user_id, messageId, await req.json().catch(() => null)));
});

export const DELETE = withAuth(async (session, _req, ctx: Ctx) => {
  const { messageId } = await ctx.params;
  return ok(await chatService.deleteCustomerMessage(session.user_id, messageId));
});
