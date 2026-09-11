/**
 * /api/admin/reviews/[id]/sentiment
 *   GET  — ผลวิเคราะห์ความรู้สึกของรีวิวนี้ (products.view)
 *   POST — บันทึกผลจาก pipeline NLP (products.update) + ตั้ง review.is_analyzed = true
 *          body: { results: [{ aspect_id, sentiment_score, sentiment_label, sentiment_result?, extracted_aspects?, model_version? }] }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as sentimentService from "@/services/sentimentService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("products", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await sentimentService.getReviewSentiment(id));
});

export const POST = withPermission("products", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  return created(await sentimentService.recordSentimentResults(id, body.results ?? []));
});
