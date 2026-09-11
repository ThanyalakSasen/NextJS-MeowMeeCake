/**
 * PUT /api/admin/users/[id]/password — แอดมินตั้งรหัสผ่านใหม่ให้ (employees.update)
 *   body: { new_password }  — ไม่ต้องยืนยันรหัสเดิม + ปลดล็อกบัญชี
 *   (ผู้ใช้เปลี่ยนรหัสตัวเองที่ /api/shop/me/password)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as userService from "@/services/userService";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withPermission("employees", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const next = body.new_password ?? body.newPassword;
  if (!next) throw badRequest("ต้องระบุ new_password");
  const result = await userService.adminSetPassword(id, next);
  audit(req, {
    action: "แอดมินตั้งรหัสผ่านใหม่ให้ผู้ใช้",
    action_type: "UPDATE",
    entity: "User",
    entity_id: id,
  });
  return ok(result);
});
