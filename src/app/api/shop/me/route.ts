/**
 * /api/shop/me — โปรไฟล์ของผู้ใช้ที่ล็อกอิน
 *   GET   — ดูข้อมูลตัวเอง (ไม่มีฟิลด์ลับ)
 *   PATCH — แก้ได้เฉพาะฟิลด์โปรไฟล์ (ชื่อ, เบอร์, วันเกิด, รูป, ข้อมูลแพ้อาหาร)
 *           ไม่สามารถแก้ email / role_id / is_active / ข้อมูลการจ้างงาน ผ่านที่นี่
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as userService from "@/services/userService";

export const GET = withAuth(async (session) => {
  return ok({ user: await userService.getUserById(session.user_id) });
});

export const PATCH = withAuth(async (session, req) => {
  const body = await req.json();
  return ok({ user: await userService.updateProfile(session.user_id, body) });
});
