/**
 * /api/shop/me — โปรไฟล์ของผู้ใช้ที่ล็อกอิน
 *   GET   — ดูข้อมูลตัวเอง (ไม่มีฟิลด์ลับ)
 *   PATCH — แก้ได้เฉพาะฟิลด์โปรไฟล์ (ชื่อ, เบอร์, วันเกิด, รูป, ข้อมูลแพ้อาหาร,
 *           บัญชีพร้อมเพย์รับเงินคืน refund_promptpay_id/name — null = ล้าง)
 *           ไม่สามารถแก้ email / role_id / is_active / ข้อมูลการจ้างงาน ผ่านที่นี่
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parseBody } from "@/lib/validate";
import { updateProfileBody } from "@/schemas/user";
import * as userService from "@/services/userService";
import * as pointsService from "@/services/pointsService";

export const GET = withAuth(async (session) => {
  return ok({ user: await userService.getUserById(session.user_id, { self: true }) });
});

export const PATCH = withAuth(async (session, req) => {
  const data = await parseBody(req, updateProfileBody);
  const user = await userService.updateProfile(session.user_id, data);
  // ข้อมูลส่วนตัวครบ → โบนัส 10 แต้มครั้งเดียว (customer-backend-merge.md §8.11)
  await pointsService.safely("profile", () => pointsService.checkProfileCompletion(session.user_id));
  return ok({ user });
});
