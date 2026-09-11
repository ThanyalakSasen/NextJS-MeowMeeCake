/**
 * /api/admin/attendances/[id]
 *   GET    — ดูบันทึกเวลารายตัว (employees.view)
 *   PATCH  — แก้ status / note / check_in_at / check_out_at / recorded_by (employees.update)
 *   DELETE — ลบบันทึก soft (employees.delete)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as attendanceService from "@/services/attendanceService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("employees", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await attendanceService.getAttendanceById(id));
});

export const PATCH = withPermission("employees", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  return ok(await attendanceService.updateAttendance(id, body));
});

export const DELETE = withPermission("employees", "delete", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await attendanceService.deleteAttendance(id));
});
