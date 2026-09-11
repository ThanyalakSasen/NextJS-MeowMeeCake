/**
 * /api/admin/users/[id]
 *   GET    — ดูผู้ใช้รายตัว (employees.view)
 *   PATCH  — แก้โปรไฟล์ / การจ้างงาน / role_id / is_active (employees.update)
 *   DELETE — ลบผู้ใช้ soft + ปิดใช้งาน (employees.delete)
 *
 * (ผู้ใช้แก้โปรไฟล์ตัวเองที่ /api/shop/me)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import * as userService from "@/services/userService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("employees", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await userService.getUserById(id, { includeDeleted }));
});

export const PATCH = withPermission("employees", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
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

export const DELETE = withPermission("employees", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await userService.deleteUser(id);
  audit(req, { action: "ลบผู้ใช้", action_type: "DELETE", entity: "User", entity_id: id });
  return ok(result);
});
