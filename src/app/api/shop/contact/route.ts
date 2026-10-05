/**
 * POST /api/shop/contact — ลูกค้าส่งข้อความหาร้าน (ฟอร์ม "ส่งข้อความหาเรา" · customer-backend-merge.md §8.17)
 *   body: { topic, message } (หัวข้อ: GET /api/catalog/contact-topics · ข้อความ ≤ 1000 ตัวอักษร)
 *   → แจ้งเตือนหลังร้าน หมวด "ลูกค้า" + LINE เจ้าของร้าน · ชื่อ/เบอร์/อีเมลจากบัญชี · 1 ข้อความ/นาที (429)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as contactService from "@/services/contactService";

export const POST = withAuth(async (session, req) =>
  ok(await contactService.sendContactMessage(session.user_id, await req.json().catch(() => null)))
);
