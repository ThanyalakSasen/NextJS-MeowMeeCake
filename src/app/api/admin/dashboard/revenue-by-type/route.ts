/**
 * GET /api/admin/dashboard/revenue-by-type — รายรับแยกตามประเภทสินค้า (reports.view — ใช้ที่หน้าสรุปกำไร-ขาดทุน)
 *   ?date_from= ?date_to=
 *   คืน: { in_store, online, preorder, unclassified, total, orders } เป็นบาท — ดู dashboardService.revenueByProductType
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as dashboardService from "@/services/dashboardService";

export const GET = withPermission("reports", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(
    await dashboardService.revenueByProductType({
      date_from: sp.get("date_from") ?? undefined,
      date_to: sp.get("date_to") ?? undefined,
    })
  );
});
