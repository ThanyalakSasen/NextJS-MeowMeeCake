/**
 * /api/shop/reviews/[id]  (รีวิวของตัวเอง)
 *   PATCH  — แก้รีวิว  body: { rating?, review_text?, image? }
 *   DELETE — ลบรีวิวของตัวเอง (soft)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parseBody } from "@/lib/validate";
import { reviewUpdateBody } from "@/schemas/review";
import * as reviewService from "@/services/reviewService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const data = await parseBody(req, reviewUpdateBody);
  return ok(
    await reviewService.updateReview(id, session.user_id, {
      rating: data.rating,
      review_text: data.review_text,
      image: data.image,
    })
  );
});

export const DELETE = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await reviewService.deleteReview(id, { by_user_id: session.user_id }));
});
