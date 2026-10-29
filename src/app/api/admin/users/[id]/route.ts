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
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { parseBool } from "@/lib/queryParams";
import { updateUserBody } from "@/schemas/user";
import * as userService from "@/services/userService";
import { assertKeepsOwner, assertMayAssignRole, assertMayManageUser } from "@/services/ownerProtection";
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
  await assertKeepsOwner(session, id, { is_active: body.is_active, role_id: body.role_id });
  const before = await userService.getUserById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await userService.updateUser(id, body);
  // ทุกการแก้ไข log ก่อน/หลังรายฟิลด์ (เดิม log เฉพาะเปลี่ยนบทบาท/เปิด-ปิดบัญชี โดยไม่มีค่า)
  auditChange(req, {
    op: "update",
    noun: "ผู้ใช้",
    entity: "User",
    entity_id: id,
    before,
    after: (await userService.getUserById(id, { includeDeleted: true }).catch(() => undefined)) ?? result,
    keys: Object.keys(body),
  });
  return ok(result);
});

export const DELETE = withPermission("employees", "delete", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  await assertMayManageUser(session, id);
  await assertMayManageUserWithin(session, id);
  await assertKeepsOwner(session, id, { remove: true });
  const before = await userService.getUserById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await userService.deleteUser(id);
  auditChange(req, {
    op: "delete",
    noun: "ผู้ใช้",
    entity: "User",
    entity_id: id,
    before,
    keys: ["user_fullname", "email", "role_id"],
  });
  return ok(result);
});
