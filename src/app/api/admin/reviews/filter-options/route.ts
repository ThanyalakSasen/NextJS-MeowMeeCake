/**
 * GET /api/admin/reviews/filter-options — ตัวเลือกตัวกรองของหน้ารายการรีวิว (reports.view · §8.20)
 *   { products: [{ product_id, product_name_th, is_deleted, review_count, avg_rating }],
 *     categories: [{ category_id, category_name, review_count, avg_rating }],
 *     reply_suggestions: [{ text, used_count, rating_avg }] (คำตอบเก่า ≤ 50) }
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as reviewModerationService from "@/services/reviewModerationService";

export const GET = withPermission("reports", "view", async () => ok(await reviewModerationService.getFilterOptions()));
