/**
 * GET /api/shop/chat — ห้องแชทของฉัน + ข้อความ (แทนฟอร์ม "ส่งข้อความหาเรา" · services/chatService.ts)
 *   ?after=<ISO>  ข้อความตั้งแต่เวลานั้น (polling — รวมเวลาเท่ากัน client ตัดซ้ำด้วย _id)
 *   ?before=<ISO> ข้อความเก่ากว่า (เลื่อนขึ้นดูย้อนหลัง) · ไม่ส่ง = ข้อความล่าสุด · ?limit= (≤100)
 *   → { conversation | null, messages: [...เก่า→ใหม่], has_more }
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(await chatService.getMyChat(session.user_id, { after: sp.get("after"), after_id: sp.get("after_id"), before: sp.get("before"), limit: sp.get("limit") }));
});
