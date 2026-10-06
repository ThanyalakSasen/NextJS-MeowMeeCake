/**
 * GET /api/auth/line?next=/customer — เริ่มเข้าสู่ระบบด้วย LINE (frontend แยก origin · ออก cookie `session` ของหลัก)
 *   frontend พาเบราว์เซอร์มาที่นี่ (top-level navigation ไม่ใช่ fetch) → ตั้ง cookie nonce (10 นาที) →
 *   redirect ไปหน้ายินยอมของ LINE · กลับมาที่ /api/auth/line/callback — src/lib/lineLogin.ts
 *   next = path ปลายทางในหน้า frontend (ภายในเท่านั้น) ส่งต่อกลับไปให้ frontend ตัดสินตาม role อีกรอบ
 *   ยังไม่ได้ตั้งค่า (LINE_AUTH_CALLBACK_URL / LINE_AUTH_RETURN_URL) → 400 · ถี่เกิน → กลับหน้า login พร้อม error
 * ต่างจาก next-auth (/api/auth/signin/line) ที่ redirect กลับได้เฉพาะโดเมนของ backend เอง
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/lib/apiResponse";
import { badRequest, isHttpError } from "@/lib/httpError";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import {
  LINE_LOGIN_NONCE_COOKIE,
  LINE_LOGIN_TTL_SECONDS,
  buildAuthorizeUrl,
  lineAuthConfig,
  safeNextPath,
  signLoginState,
} from "@/lib/lineLogin";

export const dynamic = "force-dynamic";

export const GET = route(async (req: NextRequest) => {
  const config = lineAuthConfig();
  if (!config) throw badRequest("ระบบยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วย LINE");

  try {
    rateLimit(clientIp(req), "auth:line", { limit: 10, windowMs: 60_000 });
  } catch (err) {
    if (!isHttpError(err)) throw err;
    const back = new URL(config.returnUrl);
    back.searchParams.set("error", err.message);
    return NextResponse.redirect(back);
  }

  const nonce = randomUUID();
  const state = await signLoginState(nonce, safeNextPath(req.nextUrl.searchParams.get("next")));
  const res = NextResponse.redirect(buildAuthorizeUrl(config, state, "openid profile email"));
  // Lax: ส่งกลับมาตอน LINE redirect (top-level GET) ได้ · path แคบ = ไม่ติดไปกับ request อื่น
  res.cookies.set(LINE_LOGIN_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/api/auth/line",
    maxAge: LINE_LOGIN_TTL_SECONDS,
  });
  return res;
});
