/**
 * /api/admin/reviews/[id]
 *   GET    — ดูรีวิวรายตัว (products.view)
 *   DELETE — ลบรีวิว soft (products.delete)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as reviewService from "@/services/reviewService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("products", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await reviewService.getReviewById(id));
});

export const DELETE = withPermission("products", "delete", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await reviewService.deleteReview(id));
});
