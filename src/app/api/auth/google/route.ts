/**
 * POST /api/auth/google — เข้าสู่ระบบด้วย Google (ID-token flow)
 *   body: { credential }   // ID token (JWT) จาก Google Identity Services ฝั่ง frontend
 *   authService.loginWithGoogle ตรวจ signature (JWKS) + iss + aud (GOOGLE_CLIENT_ID) + exp
 *   rate-limit 10 ครั้ง/นาที ต่อ IP
 *   สำเร็จ → 200 { user } + เซ็ต cookie `session` (สร้างบัญชี customer ให้ถ้ายังไม่มี)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { badRequest } from "@/lib/httpError";
import { rateLimit } from "@/lib/rateLimit";
import { attachSession } from "@/lib/session";
import { clientIp } from "@/lib/request";
import * as authService from "@/services/authService";

export const POST = route(async (req: NextRequest) => {
  const ip = clientIp(req);
  rateLimit(ip, "auth:google", { limit: 10, windowMs: 60_000 });
  const { credential } = await req.json().catch(() => ({}));
  if (!credential) throw badRequest("กรุณาส่ง credential (Google ID token)");
  const { user, token } = await authService.loginWithGoogle(credential, { ip });
  return attachSession(ok({ user }), token);
});
