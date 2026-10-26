/** POST /api/shop/chat/read — ลูกค้าเปิดห้องแชท → ข้อความจากร้านถือว่าอ่านแล้ว */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const POST = withAuth(async (session) => ok(await chatService.markReadByCustomer(session.user_id)));
