/**
 * /api/shop/reviews
 *   GET  — รีวิวของตัวเอง (?product_id= ?page= ?limit=)
 *   POST — เขียนรีวิว  body: { order_item_id, rating, review_text?, image? }
 *          รีวิวได้เฉพาะสินค้าที่ออเดอร์ completed แล้ว และ 1 รีวิว/order_item
 */
import { ok, created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
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
  const body = await req.json();
  return created(
    await reviewService.createReview({
      user_id: session.user_id,
      order_item_id: body.order_item_id,
      rating: body.rating,
      review_text: body.review_text ?? null,
      image: body.image ?? [],
    })
  );
});
