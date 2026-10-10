/**
 * /api/admin/users/[id]
 *   GET    — ดูผู้ใช้รายตัว (employees.view)
 *   PATCH  — แก้โปรไฟล์ / การจ้างงาน / role_id / is_active (employees.update)
 *   DELETE — ลบผู้ใช้ soft + ปิดใช้งาน (employees.delete)
 *
 * (ผู้ใช้แก้โปรไฟล์ตัวเองที่ /api/shop/me)
 * ผู้ที่ไม่ใช่ owner: แก้ / ลบบัญชีในบทบาท owner ไม่ได้ · ย้ายใครเข้าบทบาท owner ไม่ได้ (ownerProtection)
 *   แก้ / ลบ / ย้ายบทบาทได้เฉพาะบัญชีและบทบาทที่สิทธิ์ไม่เกินของตัวเอง (permissionCeiling)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { parseBool } from "@/lib/queryParams";
import { updateUserBody } from "@/schemas/user";
import * as userService from "@/services/userService";
import { assertMayAssignRole, assertMayManageUser } from "@/services/ownerProtection";
import { assertMayManageUserWithin } from "@/services/permissionCeiling";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("employees", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await userService.getUserById(id, { includeDeleted }));
});

export const PATCH = withPermission("employees", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, updateUserBody);
  await assertMayManageUser(session, id);
  if (body.role_id !== undefined) await assertMayAssignRole(session, body.role_id);
  await assertMayManageUserWithin(session, id, body.role_id);
  const result = await userService.updateUser(id, body);
  // เปลี่ยน role / เปิด-ปิดใช้งาน = เหตุการณ์สำคัญ log แยกให้ชัด
  if (body.role_id !== undefined || body.is_active !== undefined) {
    audit(req, {
      action: "แก้ไขสิทธิ์/สถานะบัญชีผู้ใช้",
      action_type: "UPDATE",
      entity: "User",
      entity_id: id,
      details: { role_id: body.role_id, is_active: body.is_active },
    });
  }
  return ok(result);
});

export const DELETE = withPermission("employees", "delete", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  await assertMayManageUser(session, id);
  await assertMayManageUserWithin(session, id);
  const result = await userService.deleteUser(id);
  audit(req, { action: "ลบผู้ใช้", action_type: "DELETE", entity: "User", entity_id: id });
  return ok(result);
});
