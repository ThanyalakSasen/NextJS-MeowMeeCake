/**
 * /api/auth/reset-password — ตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล (ย้ายมาจากฝั่งลูกค้า · customer-backend-merge.md §8.9)
 *   GET ?token=…                    → ลิงก์ยังใช้ได้ไหม (หน้าเว็บเช็คก่อนแสดงฟอร์ม) · ใช้ไม่ได้ = 400
 *   POST { token, newPassword }     → ตั้งรหัสใหม่ (ห้ามซ้ำรหัสเดิม · ปลดล็อกบัญชี · session next-auth เดิมหลุด)
 *   (รับ password แทน newPassword ได้)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import * as accountService from "@/services/accountService";

export const GET = route(async (req: NextRequest) => {
  rateLimit(clientIp(req), "auth:reset-password", { limit: 20, windowMs: 60_000 });
  return ok(await accountService.checkResetToken(req.nextUrl.searchParams.get("token")));
});

export const POST = route(async (req: NextRequest) => {
  rateLimit(clientIp(req), "auth:reset-password", { limit: 10, windowMs: 60_000 });
  const body = await req.json().catch(() => ({}));
  return ok(await accountService.resetPassword(body?.token, body?.newPassword ?? body?.password));
});
