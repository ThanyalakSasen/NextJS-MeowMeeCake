/**
 * POST /api/admin/attendances/check-in — บันทึกเวลาเข้างานของ "วันนี้" (เวลาไทย)
 *   - พนักงานเช็คอินให้ตัวเอง (ใช้ user_id จาก session)
 *   - ผู้มีสิทธิ์ employees.create เช็คอินแทนคนอื่นได้ด้วย body { user_id }
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { requireAuth, requirePermission } from "@/lib/authGuard";
import * as attendanceService from "@/services/attendanceService";

export const POST = route(async (req: NextRequest) => {
  const session = requireAuth(req);
  const body = await req.json().catch(() => ({}));
  let targetUserId = session.user_id;
  if (body.user_id && body.user_id !== session.user_id) {
    await requirePermission(session, "employees", "create");
    targetUserId = body.user_id;
  }
  return ok(await attendanceService.checkIn(targetUserId, { recordedBy: session.user_id }));
});
