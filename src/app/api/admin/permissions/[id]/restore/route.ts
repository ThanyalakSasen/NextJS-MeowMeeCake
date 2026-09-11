/** POST /api/admin/permissions/[id]/restore — กู้คืนสิทธิ์ที่ถูกลบ (employees.update ; 409 ถ้ามีสิทธิ์คู่เดิมใช้งานอยู่) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as permissionService from "@/services/permissionService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("employees", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await permissionService.restorePermission(id);
  audit(req, {
    action: "กู้คืนสิทธิ์เมนู",
    action_type: "UPDATE",
    entity: "Permission",
    entity_id: id,
  });
  return ok(result);
});
