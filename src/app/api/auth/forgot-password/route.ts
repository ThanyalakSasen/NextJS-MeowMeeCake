/**
 * POST /api/auth/forgot-password — ขอลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล (อายุ 1 ชม. · ใช้ครั้งเดียว)
 *   body: { email } → { message } เหมือนกันไม่ว่าอีเมลจะมีในระบบไหม · บัญชี Google/LINE ที่ไม่มีรหัสผ่าน = 400
 *   rate-limit 3 ครั้ง/นาที ต่อ IP — ย้ายมาจากฝั่งลูกค้า (customer-backend-merge.md §8.9)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import * as accountService from "@/services/accountService";

export const POST = route(async (req: NextRequest) => {
  rateLimit(clientIp(req), "auth:forgot-password", { limit: 3, windowMs: 60_000 });
  const body = await req.json().catch(() => ({}));
  return ok(await accountService.requestPasswordReset(body?.email));
});
