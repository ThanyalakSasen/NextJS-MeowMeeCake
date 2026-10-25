/** GET /api/admin/chats/unread — ตัวเลขบนเมนู "แชทลูกค้า" (chat.view) → { unread_conversations, unanswered_conversations } */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const GET = withPermission("chat", "view", async () => ok(await chatService.shopUnreadSummary()));
