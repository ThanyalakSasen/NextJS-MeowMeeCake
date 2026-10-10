/** POST /api/admin/users/[id]/unlock — ปลดล็อกบัญชีที่ถูกล็อกจากล็อกอินผิดหลายครั้ง (employees.update) · บัญชี owner เฉพาะ owner */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as userService from "@/services/userService";
import { assertMayManageUser } from "@/services/ownerProtection";
import { assertMayManageUserWithin } from "@/services/permissionCeiling";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("employees", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  await assertMayManageUser(session, id);
  await assertMayManageUserWithin(session, id);
  const result = await userService.unlockUser(id);
  audit(req, { action: "ปลดล็อกบัญชีผู้ใช้", action_type: "UPDATE", entity: "User", entity_id: id });
  return ok(result);
});
