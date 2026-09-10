/**
 * POST /api/auth/google — เข้าสู่ระบบด้วย Google
 *   body: { credential }   // ID token (JWT) จาก Google Identity Services ฝั่ง frontend
 *   สำเร็จ → 200 { user } + เซ็ต cookie `session` (สร้างบัญชี customer ให้ถ้ายังไม่มี)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { badRequest } from "@/lib/httpError";
import { attachSession } from "@/lib/session";
import { clientIp } from "@/lib/request";
import * as authService from "@/services/authService";

export const POST = route(async (req: NextRequest) => {
  const { credential } = await req.json();
  if (!credential) throw badRequest("กรุณาส่ง credential (Google ID token)");
  const { user, token } = await authService.loginWithGoogle(credential, { ip: clientIp(req) });
  return attachSession(ok({ user }), token);
});
