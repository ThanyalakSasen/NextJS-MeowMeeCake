/**
 * /api/admin/permissions/[id]
 *   GET    — ดูสิทธิ์รายตัว (employees.view)
 *   PATCH  — แก้ flag การอนุญาต / expires_at (employees.update)
 *   DELETE — ลบสิทธิ์ soft (employees.delete)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { permissionUpdate } from "@/schemas/rbac";
import * as permissionService from "@/services/permissionService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("employees", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await permissionService.getPermissionById(id));
});

export const PATCH = withPermission("employees", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, permissionUpdate);
  const result = await permissionService.updatePermission(id, body);
  audit(req, {
    action: "แก้ไขสิทธิ์เมนู",
    action_type: "UPDATE",
    entity: "Permission",
    entity_id: id,
    details: body,
  });
  return ok(result);
});

export const DELETE = withPermission("employees", "delete", async (_s, req, ctx: Ctx) => {
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
