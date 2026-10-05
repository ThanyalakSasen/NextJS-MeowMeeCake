/**
 * GET /api/admin/reviews — รายการรีวิวของหลังร้าน (reports.view · customer-backend-merge.md §8.20) — เห็นทุกสถานะ + ข้อมูลภายใน
 *   กรอง: product_id · category_id · user_id · status (pending|approved|hidden) · rating | rating_min / rating_max ·
 *         sentiment_group (positive|neutral|negative) · aspect_id (+ sentiment) · replied · read · has_media (1|0) ·
 *         since / until (ISO) · source (customer|inferred|model|none) · order_kind (order|preorder) · q · is_visible · is_analyzed
 *   sort = newest | oldest | lowest | highest | needs_reply · ?page= ?limit= · summary=1 → { count, avg_rating, negative_rate, unreplied_negative }
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
import * as reviewModerationService from "@/services/reviewModerationService";

export const GET = withPermission("reports", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(await reviewModerationService.listAdminReviews(sp, parsePagination(sp)));
});
