/**
 * GET /api/shop/me/activity — ประวัติการทำงานของตัวเอง (หน้า "บัญชีของฉัน" หลังร้าน)
 *   ไม่ต้องมีสิทธิ์ employees.view — ล็อก user_id = ผู้ที่ล็อกอินเสมอ (ส่ง ?user_id= มาก็ไม่มีผล)
 *   ?action_type= ?date_from= ?date_to= + pagination เหมือน /api/admin/user-logs
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
import * as userLogService from "@/services/userLogService";
import type { ActionType } from "@/services/userLogService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await userLogService.listLogs({
    pagination: parsePagination(sp),
    user_id: session.user_id,
    action_type: (sp.get("action_type") as ActionType | null) ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
  });
  return ok(result);
});
