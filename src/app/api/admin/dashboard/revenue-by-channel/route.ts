/**
 * GET /api/admin/dashboard/revenue-by-channel — รายรับแยกตามช่องทางออเดอร์ (reports.view — หน้าสรุปกำไร-ขาดทุน)
 *   ?date_from= ?date_to=
 *   คืน: { web, pos, preorder, other, total, counts, orders } เป็นบาท — ดู dashboardService.revenueByChannel
 *   web = ORD- (เว็บไซต์) · pos = POS- (หน้าร้าน) · preorder = PRE- · other = เลขออเดอร์รุ่นเก่าก่อนแยก prefix
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as dashboardService from "@/services/dashboardService";

export const GET = withPermission("reports", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(
    await dashboardService.revenueByChannel({
      date_from: sp.get("date_from") ?? undefined,
      date_to: sp.get("date_to") ?? undefined,
    })
  );
});
