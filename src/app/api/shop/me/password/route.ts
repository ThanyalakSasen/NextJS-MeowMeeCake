/**
 * PATCH /api/shop/me/password — เปลี่ยนรหัสผ่านตัวเอง
 *   body: { current_password, new_password }
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import * as userService from "@/services/userService";

export const PATCH = withAuth(async (session, req) => {
  const body = await req.json();
  const current = body.current_password ?? body.currentPassword;
  const next = body.new_password ?? body.newPassword;
  if (!current || !next) throw badRequest("ต้องระบุ current_password และ new_password");
  return ok(await userService.changePassword(session.user_id, current, next));
});
