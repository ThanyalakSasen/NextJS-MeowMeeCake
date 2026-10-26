/**
 * GET /api/admin/chats — รายการห้องแชทลูกค้า (ล่าสุดก่อน) · สิทธิ์ chats.view
 *   ?search= (ชื่อ/เบอร์/อีเมลลูกค้า) &unread=true (เฉพาะที่ยังไม่อ่าน) &page=&limit=
 */
import { okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseBool, parsePagination } from "@/lib/queryParams";
import * as chatService from "@/services/chatService";

export const GET = withPermission("chats", "view", async (_session, req) => {
  const sp = req.nextUrl.searchParams;
  const { items, meta } = await chatService.listConversations({
    pagination: parsePagination(sp, 30),
    search: sp.get("search") ?? undefined,
    unreadOnly: parseBool(sp.get("unread")) === true,
  });
  return okList(items, meta);
});
