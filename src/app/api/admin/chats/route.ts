/**
 * GET /api/admin/chats — ห้องแชทกับลูกค้า (chat.view) ข้อความล่าสุดก่อน
 *   ?filter=all|unanswered|unread (unanswered = ข้อความล่าสุดเป็นของลูกค้า · unread = ร้านยังไม่เปิดอ่าน)
 *   ?q= ชื่อ/เบอร์/อีเมลลูกค้า · ?page= ?limit=
 *   → { items: [{ _id, customer: { _id, name, image }, last_message_at, last_message_text, last_sender, unread_shop }], meta }
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
import * as chatService from "@/services/chatService";

export const GET = withPermission("chat", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(await chatService.listConversations({ filter: sp.get("filter"), q: sp.get("q"), pagination: parsePagination(sp, 30, 100) }));
});
