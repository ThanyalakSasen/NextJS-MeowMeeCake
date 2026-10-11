/** POST /api/admin/users/[id]/restore — กู้คืนผู้ใช้ที่ถูกลบ (employees.update) · บัญชี owner เฉพาะ owner */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as userService from "@/services/userService";
import { assertMayManageUser } from "@/services/ownerProtection";
import { assertMayManageUserWithin } from "@/services/permissionCeiling";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("employees", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  await assertMayManageUser(session, id);
  await assertMayManageUserWithin(session, id);
  const result = await userService.restoreUser(id);
  auditChange(req, { op: "restore", noun: "ผู้ใช้", entity: "User", entity_id: id, after: await userService.getUserById(id, { includeDeleted: true }).catch(() => undefined), keys: [] });
  return ok(result);
});
