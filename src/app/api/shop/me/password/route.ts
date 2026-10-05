/**
 * PATCH /api/shop/me/password — เปลี่ยนรหัสผ่านตัวเอง
 *   body: { current_password, new_password }
 *   rate-limit 5 ครั้ง/นาที ต่อ IP
 *   สำเร็จ → session อื่นทุกเครื่องหลุด (password_changed_at · authGuard) · cookie `session` ของเครื่องนี้ออกใหม่ให้ใช้ต่อได้
 *   (session next-auth ของหน้าเว็บลูกค้าต้องล็อกอินใหม่ — แบบฝั่งลูกค้าเดิม)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import { signSession } from "@/lib/jwt";
import { attachSession } from "@/lib/session";
import * as userService from "@/services/userService";

export const PATCH = withAuth(async (session, req) => {
  rateLimit(clientIp(req), "me:password", { limit: 5, windowMs: 60_000 });
  const body = await req.json().catch(() => ({}));
  const current = body.current_password ?? body.currentPassword;
  const next = body.new_password ?? body.newPassword;
  if (!current || !next) throw badRequest("ต้องระบุ current_password และ new_password");
  const result = await userService.changePassword(session.user_id, current, next);
  if (session.source === "nextauth") return ok(result);
  const { user_id, role_id, role_type, email } = session;
  return attachSession(ok(result), await signSession({ user_id, role_id, role_type, email }));
});
