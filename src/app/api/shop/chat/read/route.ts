/** POST /api/shop/chat/read — อ่านข้อความจากร้านแล้ว (ล้างจุดแดงบนปุ่มแชท) → { unread: 0 } */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const POST = withAuth(async (session) => ok(await chatService.markMyChatRead(session.user_id)));
