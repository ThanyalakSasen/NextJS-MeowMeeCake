/**
 * /api/shop/reviews
 *   GET  — รีวิวของตัวเอง (?product_id= ?page= ?limit=) · ไม่มีข้อมูลภายในของทีมงาน
 *   POST — เขียนรีวิว body: { order_item_id | preorder_item_id | order_item_ids | preorder_item_ids, rating,
 *          review_text?, image? (≤ 5), video?, aspect_feedback?: [{ aspect_id, sentiment: positive|negative }] }
 *          - รีวิวได้เฉพาะสินค้าในออเดอร์/พรีออเดอร์ของตัวเองที่ completed **และชำระแล้ว** · 1 รีวิว/รายการ (customer-backend-merge.md §8.20)
 *          - ชิ้นเดียว → 201 รีวิว · รีวิวรวม (…_ids ≤ 30) → 201 { data: [...], failed: [{ item_id, message }] }
 *            (ไม่ผ่านเลยสักชิ้น = error ของชิ้นแรก)
 *          - รูป/วิดีโออัปโหลดก่อนที่ POST /api/shop/reviews/upload · แต้ม 15 (มีรูป 20) ครั้งเดียวต่อรายการ
 *          - แง่มุม: GET /api/catalog/review-aspects (เก็บเฉพาะที่เปิดใช้งาน)
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
    ownOnly: true,
  });
  return ok(result);
});

export const POST = withAuth(async (session, req) => {
  const data = await parseBody(req, reviewCreateBody);
  const content = {
    rating: data.rating,
    review_text: data.review_text ?? null,
    image: data.image ?? [],
    video: data.video ?? null,
    aspect_feedback: data.aspect_feedback,
  };
  if (data.order_item_ids || data.preorder_item_ids) {
    const kind = data.preorder_item_ids ? "preorder" : "order";
    return created(await reviewService.createReviews(session.user_id, kind, (data.preorder_item_ids ?? data.order_item_ids)!, content));
  }
  return created(
    await reviewService.createReview({
      ...content,
      user_id: session.user_id,
      order_item_id: data.order_item_id,
      preorder_item_id: data.preorder_item_id,
    })
  );
});
