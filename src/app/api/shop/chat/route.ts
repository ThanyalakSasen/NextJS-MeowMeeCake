/**
 * GET /api/shop/chat — ห้องแชทของฉันกับร้าน (ต้องล็อกอิน · แทนฟอร์ม "ส่งข้อความหาเรา")
 *   ?after=ISO  → เฉพาะข้อความที่ใหม่กว่า (หน้าเว็บดึงเป็นช่วงระหว่างเปิดกล่องแชท)
 *   ?before=ISO → ข้อความเก่ากว่า (เลื่อนดูย้อนหลัง · ครั้งละ 50)
 *   → { conversation: { _id, unread_customer } | null, messages: [{ _id, sender: customer|shop, text, created_at }], has_more }
 *   ไม่เห็นชื่อพนักงานที่ตอบ (เห็นเป็น "ร้าน")
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(await chatService.getMyChat(session.user_id, { after: sp.get("after"), before: sp.get("before") }));
});
