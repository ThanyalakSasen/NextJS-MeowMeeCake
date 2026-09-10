/**
 * /api/shop/reviews
 *   GET  — รีวิวของตัวเอง (?product_id= ?page= ?limit=)
 *   POST — เขียนรีวิว  body: { order_item_id, rating, review_text?, image? }
 *          รีวิวได้เฉพาะสินค้าที่ออเดอร์ completed แล้ว และ 1 รีวิว/order_item
 */
import { ok, created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parseBody } from "@/lib/validate";
import { parsePagination } from "@/lib/queryParams";
import { reviewCreateBody } from "@/schemas/review";
import * as reviewService from "@/services/reviewService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await reviewService.listReviews({
    pagination: parsePagination(sp),
    user_id: session.user_id,
    product_id: sp.get("product_id") ?? undefined,
  });
  return ok(result);
});

export const POST = withAuth(async (session, req) => {
  const data = await parseBody(req, reviewCreateBody);
  return created(
    await reviewService.createReview({
      user_id: session.user_id,
      order_item_id: data.order_item_id,
      rating: data.rating,
      review_text: data.review_text ?? null,
      image: data.image ?? [],
    })
  );
});
