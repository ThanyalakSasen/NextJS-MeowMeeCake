/**
 * POST /api/admin/attendances/check-out — บันทึกเวลาออกงานของ "วันนี้"
 *   ต้องเช็คอินก่อน, เช็คเอาท์ซ้ำได้ 409
 *   เช็คเอาท์แทนคนอื่นต้องมีสิทธิ์ employees.create
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
  return ok(await attendanceService.checkOut(targetUserId));
});
