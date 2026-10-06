/**
 * GET /api/auth/line/callback — LINE redirect กลับมาหลังผู้ใช้ยินยอม (ตั้งเป็น LINE_AUTH_CALLBACK_URL + ลงทะเบียนใน Console)
 *   query: code, state (หรือ error ถ้ากดยกเลิก)
 *   state ต้องตรงกับ cookie nonce ของเบราว์เซอร์ที่เริ่ม flow (กัน login CSRF) → แลก code เป็นโปรไฟล์ LINE →
 *   authService.loginWithLine (หา/สร้างบัญชีจาก line_user_id) → ตั้ง cookie `session` → redirect กลับ LINE_AUTH_RETURN_URL
 *   ผลลัพธ์แนบใน query: ?line=success[&next=/path] · ?line=cancelled · ?error=<ข้อความภาษาไทย>
 */
import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/lib/apiResponse";
import { badRequest, isHttpError } from "@/lib/httpError";
import { log } from "@/lib/logger";
import { clientIp } from "@/lib/request";
import { attachSession } from "@/lib/session";
import { LINE_LOGIN_NONCE_COOKIE, exchangeCodeForLineProfile, lineAuthConfig, verifyLoginState } from "@/lib/lineLogin";
import { OAuthAccountError } from "@/services/oauthService";
import * as authService from "@/services/authService";

export const dynamic = "force-dynamic";

const GENERIC_ERROR = "เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export const GET = route(async (req: NextRequest) => {
  const config = lineAuthConfig();
  if (!config) throw badRequest("ระบบยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วย LINE");

  // กลับหน้า frontend + ล้าง cookie nonce (ใช้ได้ครั้งเดียว)
  const back = (query: Record<string, string>) => {
    const url = new URL(config.returnUrl);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = NextResponse.redirect(url);
    res.cookies.set(LINE_LOGIN_NONCE_COOKIE, "", { path: "/api/auth/line", maxAge: 0 });
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back({ line: "cancelled" }); // ผู้ใช้กดไม่ยินยอมในหน้า LINE

  const verified = await verifyLoginState(params.get("state") ?? "", req.cookies.get(LINE_LOGIN_NONCE_COOKIE)?.value);
  const code = params.get("code");
  if (!verified || !code) {
    return back({ error: "ลิงก์เข้าสู่ระบบด้วย LINE หมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง" });
  }

  try {
    const profile = await exchangeCodeForLineProfile(config, code);
    const { token } = await authService.loginWithLine(profile, { ip: clientIp(req) });
    return attachSession(back({ line: "success", ...(verified.next ? { next: verified.next } : {}) }), token);
  } catch (err) {
    // สถานะบัญชี (ปิด/ลบ/ล็อก · อีเมลซ้ำกับบัญชีอื่น) = ข้อความที่ตั้งใจให้ผู้ใช้เห็น
    if (err instanceof OAuthAccountError || isHttpError(err)) return back({ error: err.message });
    log.error("auth.line_login_failed", { err });
    return back({ error: GENERIC_ERROR });
  }
});
