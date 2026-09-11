/** POST /api/admin/users/[id]/restore — กู้คืนผู้ใช้ที่ถูกลบ (employees.update) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as userService from "@/services/userService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("employees", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await userService.restoreUser(id);
  audit(req, { action: "กู้คืนผู้ใช้", action_type: "UPDATE", entity: "User", entity_id: id });
  return ok(result);
});
