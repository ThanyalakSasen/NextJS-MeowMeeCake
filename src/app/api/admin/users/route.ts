/**
 * /api/admin/users
 *   GET  — รายการผู้ใช้ (employees.view) — ?search= ?role_id= ?role_type=owner,staff ?is_active= ?employment_type=
 *   POST — สร้างผู้ใช้ (employees.create) — auth_provider "local" ต้องมี password / "google" ต้องมี googleId
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { badRequest } from "@/lib/httpError";
import { parseBool, parsePagination, parseSort } from "@/lib/queryParams";
import { createUserBody } from "@/schemas/user";
import * as userService from "@/services/userService";

const ROLE_TYPES = ["owner", "staff", "customer"] as const;

/** ?role_type=owner,staff → ["owner","staff"] · ค่าที่ไม่รู้จัก = 400 (ไม่เงียบ ๆ ปล่อยผ่านจนรายการกว้างเกินที่ขอ) */
function parseRoleTypes(raw: string | null): (typeof ROLE_TYPES)[number][] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = parts.filter((p) => !(ROLE_TYPES as readonly string[]).includes(p));
  if (bad.length) throw badRequest(`role_type ต้องเป็น ${ROLE_TYPES.join(", ")} (คั่นด้วย ,) — ไม่รู้จัก: ${bad.join(", ")}`);
  return parts as (typeof ROLE_TYPES)[number][];
}

export const GET = withPermission("employees", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await userService.listUsers({
    pagination: parsePagination(sp),
    search: sp.get("search") ?? undefined,
    role_id: sp.get("role_id") ?? undefined,
    role_type: parseRoleTypes(sp.get("role_type")),
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
  const body = await parseBody(req, createUserBody);
  const result = await userService.createUser(body);
  audit(req, {
    action: "สร้างผู้ใช้ใหม่",
    action_type: "CREATE",
    entity: "User",
    entity_id: result?._id ? String(result._id) : null,
    details: { email: body.email, role_id: body.role_id },
  });
  return created(result);
});
