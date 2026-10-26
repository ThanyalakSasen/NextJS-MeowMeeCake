/** GET /api/admin/chats/unread — { conversations, messages } ที่ร้านยังไม่อ่าน (ป้ายตัวเลขเมนู) · chats.view */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const GET = withPermission("chats", "view", async () => ok(await chatService.staffUnreadSummary()));
