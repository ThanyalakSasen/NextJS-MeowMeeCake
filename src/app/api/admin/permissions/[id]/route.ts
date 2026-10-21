/**
 * /api/admin/permissions/[id]
 *   GET    — ดูสิทธิ์รายตัว (employees.view)
 *   PATCH  — แก้ flag การอนุญาต / expires_at (employees.update) · ผู้ที่ไม่ใช่ owner เปิดได้เฉพาะ flag ที่ตัวเองมี (permissionCeiling)
 *   DELETE — ลบสิทธิ์ soft (employees.delete)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit, auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { permissionUpdate } from "@/schemas/rbac";
import * as permissionService from "@/services/permissionService";
import { assertMayGrantExisting } from "@/services/permissionCeiling";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission(["permissions", "employees"], "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await permissionService.getPermissionById(id));
});

export const PATCH = withPermission("permissions", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, permissionUpdate);
  await assertMayGrantExisting(session, id, body);
  const before = await permissionService.getPermissionById(id);
  const result = await permissionService.updatePermission(id, body);
  // ก่อน/หลังของ flag ที่แก้ + บทบาท/เมนูใน details (หน้า "บันทึกการทำงาน" แสดงเป็นบริบท — userLogPresenter)
  const role = before.role_id as { _id?: unknown } | string | null;
  auditChange(req, {
    op: "update",
    noun: "สิทธิ์เมนู",
    entity: "Permission",
    entity_id: id,
    before,
    after: result,
    keys: Object.keys(body),
    details: {
      role_id: role && typeof role === "object" ? String(role._id) : role,
      menu_key: before.menu_key,
    },
  });
  return ok(result);
});

export const DELETE = withPermission("permissions", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await permissionService.deletePermission(id);
  audit(req, {
    action: "ถอนสิทธิ์เมนู",
    action_type: "DELETE",
    entity: "Permission",
    entity_id: id,
  });
  return ok(result);
});
