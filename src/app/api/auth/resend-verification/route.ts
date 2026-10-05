/**
 * POST /api/auth/resend-verification — ขอส่งอีเมลยืนยันใหม่ (ลิงก์หมดอายุ / ลูกค้าเก่าที่สมัครก่อนบังคับยืนยัน)
 *   body: { email } → { message } เหมือนกันทุกกรณี (กันเดาอีเมล) · rate-limit 3 ครั้ง/นาที ต่อ IP
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import * as accountService from "@/services/accountService";

export const POST = route(async (req: NextRequest) => {
  rateLimit(clientIp(req), "auth:resend-verification", { limit: 3, windowMs: 60_000 });
  const body = await req.json().catch(() => ({}));
  return ok(await accountService.resendVerification(body?.email));
});
