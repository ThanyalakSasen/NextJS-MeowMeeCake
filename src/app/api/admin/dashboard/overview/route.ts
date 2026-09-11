/**
 * GET /api/admin/dashboard/overview — ภาพรวม (dashboard.view)
 *   ?date_from= ?date_to=
 *   คืน: ยอดออเดอร์ตามสถานะ, รายได้ (paid), ส่วนลดที่ให้, ค่าใช้จ่าย, COGS, กำไรโดยประมาณ, จำนวนของใกล้หมด
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as dashboardService from "@/services/dashboardService";

export const GET = withPermission("dashboard", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(
    await dashboardService.overview({
      date_from: sp.get("date_from") ?? undefined,
      date_to: sp.get("date_to") ?? undefined,
    })
  );
});
