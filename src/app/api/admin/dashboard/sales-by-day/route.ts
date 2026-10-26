/** GET /api/admin/dashboard/sales-by-day — ยอดขายรายวัน (dashboard.view) ?days=30 (สูงสุด 180)
 *   คืน: { from, to, series: [{ date, revenue, orders, channels: { web, pos, preorder, other: { revenue, orders } } }] } เป็นบาท */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseNumber } from "@/lib/queryParams";
import * as dashboardService from "@/services/dashboardService";

export const GET = withPermission("dashboard", "view", async (_s, req) => {
  return ok(
    await dashboardService.salesByDay({
      days: parseNumber(req.nextUrl.searchParams.get("days")),
    })
  );
});
