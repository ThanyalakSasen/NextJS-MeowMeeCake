/**
 * PATCH /api/shop/me/password — เปลี่ยนรหัสผ่านตัวเอง
 *   body: { current_password, new_password }
 *   rate-limit 5 ครั้ง/นาที ต่อ IP
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import * as userService from "@/services/userService";

export const PATCH = withAuth(async (session, req) => {
  rateLimit(clientIp(req), "me:password", { limit: 5, windowMs: 60_000 });
  const body = await req.json().catch(() => ({}));
  const current = body.current_password ?? body.currentPassword;
  const next = body.new_password ?? body.newPassword;
  if (!current || !next) throw badRequest("ต้องระบุ current_password และ new_password");
  return ok(await userService.changePassword(session.user_id, current, next));
});
