/**
 * PUT /api/admin/permissions/role/[roleId] — บันทึกสิทธิ์ทั้งบทบาทในคำขอเดียว (permissions.update · มีแถวใหม่ต้อง permissions.create ด้วย)
 *   body: { rows: [{ menu_key, can_view?, can_create?, can_update?, can_delete?, can_approve? }] }
 *   เอกสารบั๊กข้อ 12 — เดิมหน้าสิทธิ์ยิง POST/PATCH ทีละเมนู ล้มกลางทาง = บทบาทได้สิทธิ์ไปบางเมนู
 *   ตรวจทุกแถว (บทบาท / เมนู / เพดานสิทธิ์ของผู้ทำ) ก่อน แล้วเขียนรวดเดียว (transaction บน replica set)
 *   แถวที่ยังไม่มีและไม่ได้เปิด flag ไหน = ไม่สร้าง · flag ที่ไม่เปลี่ยน = ไม่แตะ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission, requirePermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { rolePermissionsBody } from "@/schemas/rbac";
import * as permissionService from "@/services/permissionService";
import { assertMayGrant, assertMayGrantExisting } from "@/services/permissionCeiling";

type Ctx = { params: Promise<{ roleId: string }> };

export const PUT = withPermission("permissions", "update", async (session, req, ctx: Ctx) => {
  const { roleId } = await ctx.params;
  const { rows } = await parseBody(req, rolePermissionsBody);
  const plan = await permissionService.planRolePermissions(roleId, rows);
  if (plan.creates.length) await requirePermission(session, "permissions", "create");
  for (const c of plan.creates) await assertMayGrant(session, c.menu_key, c);
  for (const u of plan.updates) await assertMayGrantExisting(session, u.id, u.changed);

  const result = await permissionService.saveRolePermissions(roleId, plan, session.user_id);
  if (result.created || result.updated) {
    audit(req, {
      action: `บันทึกสิทธิ์เมนูของบทบาท (เพิ่ม ${result.created} · แก้ ${result.updated} เมนู)`,
      action_type: "UPDATE",
      entity: "Permission",
      entity_id: null,
      details: {
        role_id: roleId,
        created: plan.creates.map((c) => c.menu_key),
        updated: plan.updates.map((u) => ({ menu_key: u.menu_key, ...u.changed })),
      },
    });
  }
  return ok(result);
});
