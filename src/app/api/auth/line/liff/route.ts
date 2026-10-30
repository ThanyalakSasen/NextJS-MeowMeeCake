/**
 * POST /api/auth/line/liff — เข้าสู่ระบบอัตโนมัติตอนลูกค้าเปิดหน้าร้านผ่าน LIFF ในแอป LINE (Rich Menu → liff.line.me/<LIFF_ID>)
 *   body: { idToken }   // liff.getIDToken() ฝั่ง frontend (LIFF app ต้องอยู่ใต้ LINE Login channel = LINE_LOGIN_CHANNEL_ID)
 *   ให้ LINE ตรวจ id_token (verifyLineIdToken) → authService.loginWithLine (หา/สร้างบัญชีจาก line_user_id
 *   = บัญชีเดียวกับปุ่ม "เข้าสู่ระบบด้วย LINE") → 200 { user } + เซ็ต cookie `session`
 *   rate-limit 10 ครั้ง/นาที ต่อ IP · id_token ปลอม/หมดอายุ → 401 · บัญชีปิด/ลบ/ล็อก → 400 พร้อมข้อความ
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { badRequest, unauthorized } from "@/lib/httpError";
import { log } from "@/lib/logger";
import { rateLimit } from "@/lib/rateLimit";
import { attachSession } from "@/lib/session";
import { clientIp } from "@/lib/request";
import { verifyLineIdToken } from "@/lib/lineLogin";
import { OAuthAccountError } from "@/services/oauthService";
import * as authService from "@/services/authService";

export const dynamic = "force-dynamic";

export const POST = route(async (req: NextRequest) => {
  const ip = clientIp(req);
  await rateLimit(ip, "auth:line-liff", { limit: 10, windowMs: 60_000 });
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) throw badRequest("ระบบยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วย LINE");
  const { idToken } = await req.json().catch(() => ({}));
  if (typeof idToken !== "string" || !idToken) throw badRequest("กรุณาส่ง idToken (LIFF ID token)");

  let profile;
  try {
    profile = await verifyLineIdToken(channelId, idToken);
  } catch (err) {
    log.warn("auth.line_liff_verify_failed", { err });
    throw unauthorized("เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาปิดแล้วเปิดหน้านี้ใหม่");
  }

  try {
    const { user, token } = await authService.loginWithLine(profile, { ip });
    return attachSession(ok({ user }), token);
  } catch (err) {
    // สถานะบัญชี (ปิด/ลบ/ล็อก · อีเมลซ้ำกับบัญชีอื่น) = ข้อความที่ตั้งใจให้ผู้ใช้เห็น
    if (err instanceof OAuthAccountError) throw badRequest(err.message);
    throw err;
  }
});
