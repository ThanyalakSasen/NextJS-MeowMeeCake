/**
 * /api/shop/me/email — อีเมลของบัญชีที่สมัครด้วย LINE (ย้ายมาจากฝั่งลูกค้า /api/customer/line/email · §8.9)
 *   GET  → { auth_provider, line_linked, needs_email, email, email_verified }
 *          needs_email = ยังใช้อีเมลชั่วคราว (LINE ไม่ได้ให้อีเมล) → หน้าเว็บให้กรอกอีเมลจริง
 *   POST { email } → ตั้งอีเมลจริง + ส่งลิงก์ยืนยัน (เฉพาะบัญชี LINE ที่อีเมลยังไม่ยืนยัน) · อีเมลซ้ำบัญชีอื่น = 409
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as accountService from "@/services/accountService";
import { resolveProfileSetupNotices } from "@/services/customerNotifyService";

export const GET = withAuth(async (session) => ok(await accountService.emailStatus(session.user_id)));

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => ({}));
  const result = await accountService.setLineAccountEmail(session.user_id, body?.email);
  // ตั้งอีเมลจริงแล้ว + เบอร์/วันเกิดครบ → ป๊อปอัปชวนกรอกข้อมูลหยุดเด้ง
  await resolveProfileSetupNotices(session.user_id);
  return ok(result);
});
