/**
 * contactService — ฟอร์ม "ส่งข้อความหาเรา" ของลูกค้า (ย้ายมาจากฝั่งลูกค้า contactController · customer-backend-merge.md §8.17)
 *
 * ส่งถึงร้านทาง **แจ้งเตือนหลังร้าน (หมวด "ลูกค้า") + LINE เจ้าของร้าน** (ผู้ใช้เลือก 2026-10-05) — ไม่ได้ส่งอีเมล
 * ชื่อ/เบอร์/อีเมลผู้ส่งดึงจากบัญชีที่ล็อกอิน (ไม่รับจาก client — กันแอบอ้าง) · กันกดรัว: 1 ข้อความ/นาที/บัญชี
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { rateLimit } from "../lib/rateLimit";
import { CONTACT_MESSAGE_MAX_LENGTH, CONTACT_TOPICS, type ContactTopic } from "../lib/contactTopics";
import userModel from "../models/userModel";
import { notificationService } from "./notificationService";
import { isPlaceholderEmail } from "./oauthService";

export async function sendContactMessage(userId: string, body: { topic?: unknown; message?: unknown } | null) {
  if (!body || typeof body !== "object") throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  const topic: ContactTopic = CONTACT_TOPICS.find((t) => t === body.topic) ?? "เรื่องอื่นๆ";
  const message = String(body.message ?? "").trim();
  if (!message) throw badRequest("กรุณาระบุรายละเอียดข้อความ");
  if (message.length > CONTACT_MESSAGE_MAX_LENGTH) {
    throw badRequest(`ข้อความยาวได้ไม่เกิน ${CONTACT_MESSAGE_MAX_LENGTH} ตัวอักษร`);
  }

  await dbConnect();
  const user = await userModel
    .findOne({ _id: userId, deleted_at: null })
    .select("user_fullname user_phone email")
    .lean<{ user_fullname?: string; user_phone?: string | null; email?: string } | null>();
  if (!user) throw notFound("ไม่พบบัญชีผู้ใช้");

  // 1 ข้อความต่อนาทีต่อบัญชี (429) — นับหลังตรวจข้อมูลผ่าน (กรอกผิดแล้วแก้ส่งใหม่ได้ทันที)
  rateLimit(userId, "shop:contact", { limit: 1, windowMs: 60_000 });

  const email = user.email && !isPlaceholderEmail(user.email) ? user.email : "";
  const contact = [user.user_phone ? `โทร ${user.user_phone}` : "", email ? `อีเมล ${email}` : ""]
    .filter(Boolean)
    .join(" · ");

  await notificationService.notify({
    title: `ข้อความจากลูกค้า: ${topic}`,
    message: `${user.user_fullname || "ลูกค้า"}${contact ? ` (${contact})` : ""}: ${message}`,
    module: "customer",
    type: "info",
  });
  return { sent: true };
}
