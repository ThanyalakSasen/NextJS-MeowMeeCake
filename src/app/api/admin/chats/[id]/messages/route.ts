/**
 * /api/admin/chats/:id/messages
 *   GET  (chat.view)   ?after=ISO | ?before=ISO → { messages: [{ _id, sender, text, created_at, sender_name }], has_more }
 *   POST (chat.create) { text?, ref? } → ตอบลูกค้า · ref = การ์ดคำสั่งซื้อของลูกค้าห้องนี้ { kind, id }
 *        ข้อความแรกที่ลูกค้ายังไม่อ่าน → กระดิ่งลูกค้า (ไม่ส่ง LINE)
 */
import type { NextRequest } from "next/server";
import { created, ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("chat", "view", async (_s, req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  return ok(await chatService.getMessagesForShop(id, { after: sp.get("after"), before: sp.get("before") }));
});

export const POST = withPermission("chat", "create", async (session, req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as chatService.ChatSendInput | null;
  return created(await chatService.sendFromShop(id, session.user_id, { text: body?.text, ref: body?.ref ?? null }));
});
