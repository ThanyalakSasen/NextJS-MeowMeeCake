/**
 * POST /api/shop/chat/messages — ส่งข้อความหาร้าน { text?, ref? } (≤ 1000 ตัวอักษร · 20 ข้อความ/นาที → 429)
 *   ref = การ์ดคำสั่งซื้อ { kind: "order"|"preorder", id } — ต้องเป็นของฉัน (ไม่ใช่ = 404) · มี ref แล้ว text ว่างได้
 *   ส่งครั้งแรก = สร้างห้องให้เอง · ข้อความแรกที่ร้านยังไม่อ่าน → กระดิ่งหลังร้าน (ไม่ส่ง LINE)
 *   → ข้อความที่สร้าง { _id, sender: "customer", text, card, created_at }
 */
import { created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const POST = withAuth(async (session, req) => {
  const body = (await req.json().catch(() => null)) as chatService.ChatSendInput | null;
  return created(await chatService.sendFromCustomer(session.user_id, { text: body?.text, ref: body?.ref ?? null }));
});
