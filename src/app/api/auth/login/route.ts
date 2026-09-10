/**
 * POST /api/auth/login
 *   body: { email, password }  — ตรวจด้วย schemas/auth.loginBody
 *   rate-limit 10 ครั้ง/นาที ต่อ IP (ทับ account-lockout ต่อบัญชีใน authService)
 *   สำเร็จ → 200 { user } + เซ็ต cookie `session` (HttpOnly JWT)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { parseBody } from "@/lib/validate";
import { loginBody } from "@/schemas/auth";
import { rateLimit } from "@/lib/rateLimit";
import { attachSession } from "@/lib/session";
import { clientIp } from "@/lib/request";
import * as authService from "@/services/authService";

export const POST = route(async (req: NextRequest) => {
  const ip = clientIp(req);
  rateLimit(ip, "auth:login", { limit: 10, windowMs: 60_000 });
  const { email, password } = await parseBody(req, loginBody);
  const { user, token } = await authService.login(email, password, { ip });
  return attachSession(ok({ user }), token);
});
