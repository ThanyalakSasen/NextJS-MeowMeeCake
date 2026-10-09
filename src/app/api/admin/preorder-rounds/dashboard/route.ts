/**
 * GET /api/admin/preorder-rounds/dashboard — สรุปรอบพรีออเดอร์ (preorder.view · frontend Q-BE5 · F4)
 *   ?status= (scheduled|open|closed|cancelled) ?search= (ชื่อรอบ) ?page= ?limit= · เรียงรอบล่าสุดก่อน
 *   ต่อรอบ: จำนวนสินค้า · จอง/โควตารวม + ต่อสินค้า (products[]) · fill_rate (%) · จำนวนพรีออเดอร์ · ลูกค้า ·
 *           ยอดขาย (ไม่รวมยกเลิก) · payment { paid | pending | cancelled: { count, amount } }
 */
import { okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import { parsePagination } from "@/lib/queryParams";
import { ROUND_STATUSES, type RoundStatus } from "@/services/preorderRoundService";
import * as dashboardService from "@/services/preorderRoundDashboardService";

export const GET = withPermission("preorder", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || undefined;
  if (status && !ROUND_STATUSES.includes(status as RoundStatus)) {
    throw badRequest(`status ต้องเป็นหนึ่งใน: ${ROUND_STATUSES.join(", ")}`);
  }
  const result = await dashboardService.getRoundsDashboard({
    pagination: parsePagination(sp),
    round_status: status as RoundStatus | undefined,
    search: sp.get("search") ?? undefined,
  });
  return okList(result.items, result.meta);
});
