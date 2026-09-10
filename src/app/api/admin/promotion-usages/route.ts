/**
 * GET /api/admin/promotion-usages — ประวัติการใช้โปรโมชัน (promotions.view)
 *   ?promotion_id= ?user_id= ?order_id= ?page= ?limit=
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
import * as promotionUsageService from "@/services/promotionUsageService";

export const GET = withPermission("promotions", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await promotionUsageService.listUsages({
    pagination: parsePagination(sp),
    promotion_id: sp.get("promotion_id") ?? undefined,
    user_id: sp.get("user_id") ?? undefined,
    order_id: sp.get("order_id") ?? undefined,
  });
  return ok(result);
});
