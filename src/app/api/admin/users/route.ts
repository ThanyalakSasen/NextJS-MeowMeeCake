/**
 * /api/admin/users
 *   GET  — รายการผู้ใช้ (employees.view) — ?search= ?role_id= ?is_active= ?employment_type=
 *   POST — สร้างผู้ใช้ (employees.create) — auth_provider "local" ต้องมี password / "google" ต้องมี googleId
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool, parsePagination, parseSort } from "@/lib/queryParams";
import * as userService from "@/services/userService";

export const GET = withPermission("employees", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await userService.listUsers({
    pagination: parsePagination(sp),
    search: sp.get("search") ?? undefined,
    role_id: sp.get("role_id") ?? undefined,
    is_active: parseBool(sp.get("is_active")),
    employment_type: (sp.get("employment_type") as "full_time" | "part_time" | null) ?? undefined,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
    sort: parseSort(
      sp,
      ["created_at", "user_fullname", "last_login_at", "start_working_date"],
      "created_at"
    ),
  });
  return ok(result);
});

export const POST = withPermission("employees", "create", async (_s, req) => {
  const body = await req.json();
  const result: any = await userService.createUser(body);
  audit(req, {
    action: "สร้างผู้ใช้ใหม่",
    action_type: "CREATE",
    entity: "User",
    entity_id: result?._id ? String(result._id) : null,
    details: { email: body.email, role_id: body.role_id },
  });
  return created(result);
});
