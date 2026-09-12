/**
 * POST /api/admin/attendances/check-out — บันทึกเวลาออกงานของ "วันนี้"
 *   ต้องเช็คอินก่อน, เช็คเอาท์ซ้ำได้ 409
 *   เช็คเอาท์แทนคนอื่นต้องมีสิทธิ์ employees.create
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { requireAuth, requirePermission } from "@/lib/authGuard";
import { parse } from "@/lib/validate";
import { checkInOutBody } from "@/schemas/attendance";
import * as attendanceService from "@/services/attendanceService";

export const POST = route(async (req: NextRequest) => {
  const session = requireAuth(req);
  // .catch(() => ({})) ก่อน parse — self check-out ไม่ต้องส่ง body เลยก็ได้ (ไม่ใช่ JSON ผิดรูป)
  const body = parse(await req.json().catch(() => ({})), checkInOutBody);
  let targetUserId = session.user_id;
  if (body.user_id && body.user_id !== session.user_id) {
    await requirePermission(session, "employees", "create");
    targetUserId = body.user_id;
  }
  return ok(await attendanceService.checkOut(targetUserId));
});
