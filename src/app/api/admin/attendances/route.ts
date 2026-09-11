/**
 * /api/admin/attendances
 *   GET  — รายการบันทึกเวลา — ดูของตัวเองได้ (?user_id=<ตัวเอง>) ; ดูของคนอื่นต้องมี employees.view
 *   POST — บันทึกแทน (employees.create) — recorded_by = ผู้ทำรายการเสมอ
 *          body: { user_id, work_date, status?, note?, check_in_at?, check_out_at? }
 */
import type { NextRequest } from "next/server";
import { ok, created, route } from "@/lib/apiResponse";
import { requireAuth, requirePermission } from "@/lib/authGuard";
import { parseBool, parsePagination } from "@/lib/queryParams";
import * as attendanceService from "@/services/attendanceService";
import type { AttendanceStatus } from "@/services/attendanceService";

export const GET = route(async (req: NextRequest) => {
  const session = requireAuth(req);
  const sp = req.nextUrl.searchParams;
  const userId = sp.get("user_id") ?? undefined;
  if (userId !== session.user_id) {
    await requirePermission(session, "employees", "view");
  }
  const result = await attendanceService.listAttendances({
    pagination: parsePagination(sp),
    user_id: userId,
    work_date: sp.get("work_date") ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
    status: (sp.get("status") as AttendanceStatus | null) ?? undefined,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
  });
  return ok(result);
});

export const POST = route(async (req: NextRequest) => {
  const session = requireAuth(req);
  await requirePermission(session, "employees", "create");
  const body = await req.json();
  return created(
    await attendanceService.recordAttendance({ ...body, recorded_by: session.user_id })
  );
});
