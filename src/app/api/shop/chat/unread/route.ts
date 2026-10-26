/** GET /api/shop/chat/unread — { unread } ข้อความจากร้านที่ยังไม่อ่าน (ป้ายตัวเลขบน Navbar) */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const GET = withAuth(async (session) => ok(await chatService.myUnread(session.user_id)));
