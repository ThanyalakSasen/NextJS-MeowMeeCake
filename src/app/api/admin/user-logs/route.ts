/**
 * /api/admin/user-logs
 *   GET  — ค้น log กิจกรรม (employees.view) ?user_id= ?entity= ?entity_id= ?action_type= ?date_from= ?date_to=
 *   POST — เขียน log 1 รายการ (employees.create)
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
import * as userLogService from "@/services/userLogService";
import type { ActionType } from "@/services/userLogService";

export const GET = withPermission("employees", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await userLogService.listLogs({
    pagination: parsePagination(sp),
    user_id: sp.get("user_id") ?? undefined,
    entity: sp.get("entity") ?? undefined,
    entity_id: sp.get("entity_id") ?? undefined,
    action_type: (sp.get("action_type") as ActionType | null) ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
  });
  return ok(result);
});

export const POST = withPermission("employees", "create", async (_s, req) => {
  const body = await req.json();
  return created(await userLogService.writeLogStrict(body));
});
