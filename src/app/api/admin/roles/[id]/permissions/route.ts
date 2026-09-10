/** GET /api/admin/roles/[id]/permissions — สิทธิ์ที่ใช้ได้จริงของบทบาทนี้ จัดกลุ่มตาม menu_key (employees.view) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { getEffectivePermissions } from "@/services/permissionService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("employees", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await getEffectivePermissions(id));
});
