/**
 * /api/admin/chats/quick-replies — ข้อความตอบเร็วสำเร็จรูปของหน้าแชท (ใช้ร่วมกันทั้งร้าน · สูงสุด 50)
 *   GET  (chat.view)   → { items: [{ _id, title, text, sort_order }] } เรียงตาม sort_order
 *   POST (chat.update) { title?, text, sort_order? } → ข้อความที่สร้าง (ไม่ส่ง sort_order = ต่อท้าย)
 */
import { created, ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const GET = withPermission("chat", "view", async () => ok(await chatService.listQuickReplies()));

export const POST = withPermission("chat", "update", async (session, req) => {
  const body = ((await req.json().catch(() => null)) ?? {}) as { title?: unknown; text?: unknown; sort_order?: unknown };
  return created(await chatService.createQuickReply(body, session.user_id));
});
