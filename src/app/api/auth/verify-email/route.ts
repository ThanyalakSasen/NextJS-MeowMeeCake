/**
 * /api/auth/verify-email — ยืนยันอีเมลจากลิงก์ในอีเมล (หน้าเว็บ /customer/verify-email?token=… เรียกต่อ)
 *   GET ?token=… หรือ POST { token } → { message } · token ผิด/ใช้แล้ว/หมดอายุ = 400
 *   (ฝั่งลูกค้าเดิมอยู่ที่ /api/user/verify-email — หน้าเว็บต้องเปลี่ยน path · customer-backend-merge.md §8.9)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import * as accountService from "@/services/accountService";

export const GET = route(async (req: NextRequest) => {
  rateLimit(clientIp(req), "auth:verify-email", { limit: 20, windowMs: 60_000 });
  return ok(await accountService.verifyEmail(req.nextUrl.searchParams.get("token")));
});

export const POST = route(async (req: NextRequest) => {
  rateLimit(clientIp(req), "auth:verify-email", { limit: 20, windowMs: 60_000 });
  const body = await req.json().catch(() => ({}));
  return ok(await accountService.verifyEmail(body?.token));
});
