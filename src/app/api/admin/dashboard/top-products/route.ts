/** GET /api/admin/dashboard/top-products — สินค้าขายดี (dashboard.view) ?limit=10 ?date_from= ?date_to= ?sort=qty|revenue */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseNumber } from "@/lib/queryParams";
import * as dashboardService from "@/services/dashboardService";

export const GET = withPermission(["dashboard", "reports_sales"], "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(
    await dashboardService.topProducts({
      limit: parseNumber(sp.get("limit")),
      date_from: sp.get("date_from") ?? undefined,
      date_to: sp.get("date_to") ?? undefined,
      sort: sp.get("sort") === "revenue" ? "revenue" : "qty",
    })
  );
});
