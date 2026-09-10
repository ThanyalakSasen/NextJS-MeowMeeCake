/**
 * POST /api/auth/register — ลูกค้าสมัครสมาชิกเอง (บทบาทถูกบังคับเป็น customer เสมอ)
 *   body: { user_fullname, email, password, user_phone? }  — ตรวจด้วย schemas/auth.registerBody
 *   สำเร็จ → 201 { user } + เซ็ต cookie `session` (auto login)
 */
import type { NextRequest } from "next/server";
import { created, route } from "@/lib/apiResponse";
import { parseBody } from "@/lib/validate";
import { registerBody } from "@/schemas/auth";
import { attachSession } from "@/lib/session";
import { clientIp } from "@/lib/request";
import * as authService from "@/services/authService";

export const POST = route(async (req: NextRequest) => {
  const body = await parseBody(req, registerBody);
  const { user, token } = await authService.register(
    {
      user_fullname: body.user_fullname,
      email: body.email,
      password: body.password,
      user_phone: body.user_phone ?? null,
    },
    { ip: clientIp(req) }
  );
  return attachSession(created({ user }), token);
});
