/**
 * POST /api/admin/permissions/[id]/restore — กู้คืนสิทธิ์ที่ถูกลบ (employees.update ; 409 ถ้ามีสิทธิ์คู่เดิมใช้งานอยู่)
 * ผู้ที่ไม่ใช่ owner กู้ได้เฉพาะแถวที่ flag ไม่เกินสิทธิ์ของตัวเอง (permissionCeiling)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as permissionService from "@/services/permissionService";
import { assertMayGrantExisting } from "@/services/permissionCeiling";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("employees", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  await assertMayGrantExisting(session, id);
  const result = await permissionService.restorePermission(id);
  audit(req, {
    action: "กู้คืนสิทธิ์เมนู",
    action_type: "UPDATE",
    entity: "Permission",
    entity_id: id,
  });
  return ok(result);
});
