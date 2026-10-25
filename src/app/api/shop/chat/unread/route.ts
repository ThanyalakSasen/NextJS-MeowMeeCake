/** GET /api/shop/chat/unread — จำนวนข้อความจากร้านที่ยังไม่อ่าน (จุดแดงบนปุ่มแชทลอย) → { unread } */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const GET = withAuth(async (session) => ok(await chatService.myUnread(session.user_id)));
