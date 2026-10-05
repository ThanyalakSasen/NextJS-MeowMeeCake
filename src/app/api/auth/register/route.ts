/**
 * POST /api/auth/register — ลูกค้าสมัครสมาชิกเอง (บทบาทถูกบังคับเป็น customer เสมอ)
 *   body: { user_fullname, email, password, user_phone?, user_birthday? | user_birthdate?, user_allergies? }
 *   แบบฝั่งลูกค้า (ผู้ใช้เลือก 2026-10-05 · docs/customer-backend-merge.md §8.9):
 *     สร้างบัญชี "ยังไม่ยืนยัน" + ส่งลิงก์ยืนยันทางอีเมล (24 ชม.) — **ไม่ล็อกอินให้** (เดิม: เซ็ต cookie session ทันที)
 *     ลูกค้าที่ยังไม่ยืนยันอีเมลล็อกอินไม่ได้ · ส่งอีเมลไม่ได้ = 502 + ยกเลิกการสมัคร (สมัครใหม่ได้)
 *   rate-limit 5 ครั้ง/นาที ต่อ IP · สำเร็จ → 201 { user_id, email, message }
 */
import type { NextRequest } from "next/server";
import { created, route } from "@/lib/apiResponse";
import { parseBody } from "@/lib/validate";
import { registerBody } from "@/schemas/auth";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import * as accountService from "@/services/accountService";

export const POST = route(async (req: NextRequest) => {
  rateLimit(clientIp(req), "auth:register", { limit: 5, windowMs: 60_000 });
  const body = await parseBody(req, registerBody);
  const birthday = body.user_birthdate ?? body.user_birthday ?? null;
  const result = await accountService.signup({
    user_fullname: body.user_fullname,
    email: body.email,
    password: body.password,
    user_phone: body.user_phone ?? null,
    user_birthdate: birthday ? new Date(birthday) : null,
    user_allergies: body.user_allergies ?? [],
  });
  return created(result);
});
