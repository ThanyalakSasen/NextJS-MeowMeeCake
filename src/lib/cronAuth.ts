/**
 * cronAuth — ตรวจสิทธิ์ endpoint ที่ตัวตั้งเวลาภายนอกเรียก (/api/cron/*)
 *
 * ต้องส่ง `Authorization: Bearer <CRON_SECRET>` (รูปแบบเดียวกับที่ Vercel Cron ส่งให้เองเมื่อตั้ง CRON_SECRET)
 * ไม่ตั้ง CRON_SECRET = ปิด endpoint ทั้งหมด (ตอบ 401 เสมอ) กันเปิดทิ้งไว้โดยไม่รู้ตัว
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { unauthorized } from "./httpError";

/** เทียบแบบ constant-time (hash ก่อนให้ยาวเท่ากันเสมอ — timingSafeEqual ต้องการความยาวเท่ากัน) */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function assertCronAuthorized(req: NextRequest): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw unauthorized("ยังไม่ได้ตั้งค่า CRON_SECRET — endpoint นี้ถูกปิดไว้");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token || !safeEqual(token, secret)) throw unauthorized("CRON_SECRET ไม่ถูกต้อง");
}
