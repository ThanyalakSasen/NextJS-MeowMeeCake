/**
 * /api/admin/permissions
 *   GET  — รายการสิทธิ์ (employees.view) ?role_id= ?menu_key= ?includeDeleted=
 *   POST — ให้สิทธิ์ใหม่แก่บทบาท (employees.create)
 *          body: { role_id, menu_key, granted_by, can_view?, can_create?, can_update?, can_delete?, can_approve?, expires_at? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { parseBool, parsePagination } from "@/lib/queryParams";
import { permissionCreate } from "@/schemas/rbac";
import * as permissionService from "@/services/permissionService";
import type { MenuKey } from "@/services/permissionService";

export const GET = withPermission("employees", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await permissionService.listPermissions({
    pagination: parsePagination(sp),
    role_id: sp.get("role_id") ?? undefined,
    menu_key: (sp.get("menu_key") as MenuKey | null) ?? undefined,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
  });
  return ok(result);
});

export const POST = withPermission("employees", "create", async (session, req) => {
  const body = await parseBody(req, permissionCreate);
  const result = await permissionService.createPermission({
    ...body,
    granted_by: session.user_id,
  });
  audit(req, {
    action: `ให้สิทธิ์เมนู "${body.menu_key}" แก่บทบาท`,
    action_type: "CREATE",
    entity: "Permission",
    entity_id: result?._id ? String(result._id) : null,
    details: { role_id: body.role_id, menu_key: body.menu_key },
  });
  return created(result);
});
