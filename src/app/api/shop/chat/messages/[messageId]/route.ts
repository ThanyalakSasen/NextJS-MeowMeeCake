/**
 * /api/shop/chat/messages/[messageId] — ลูกค้าแก้/ลบข้อความของตัวเอง
 *   PATCH  body: { body?, order_id? | preorder_id?, remove_attachment? } — เปลี่ยนคำสั่งซื้อที่แนบได้ (ต้องเป็นของตัวเอง)
 *   DELETE ลบข้อความ (soft delete — ร้านเห็นข้อความหายไปในรอบ polling ถัดไป)
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
