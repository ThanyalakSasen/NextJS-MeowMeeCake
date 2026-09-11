/** POST /api/admin/users/[id]/unlock — ปลดล็อกบัญชีที่ถูกล็อกจากล็อกอินผิดหลายครั้ง (employees.update) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as userService from "@/services/userService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("employees", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await userService.unlockUser(id);
  audit(req, { action: "ปลดล็อกบัญชีผู้ใช้", action_type: "UPDATE", entity: "User", entity_id: id });
  return ok(result);
});
