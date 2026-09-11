/**
 * GET /api/admin/reviews — รีวิวทั้งหมด (products.view) — เห็นที่ซ่อนด้วย
 *   ?product_id= ?user_id= ?rating= ?is_visible= ?is_analyzed= ?page= ?limit=
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseBool, parseNumber, parsePagination } from "@/lib/queryParams";
import * as reviewService from "@/services/reviewService";

export const GET = withPermission("products", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await reviewService.listReviews({
    pagination: parsePagination(sp),
    product_id: sp.get("product_id") ?? undefined,
    user_id: sp.get("user_id") ?? undefined,
    rating: parseNumber(sp.get("rating")),
    is_visible: parseBool(sp.get("is_visible")),
    is_analyzed: parseBool(sp.get("is_analyzed")),
  });
  return ok(result);
});
