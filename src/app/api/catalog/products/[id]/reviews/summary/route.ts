/** GET /api/catalog/products/[id]/reviews/summary — คะแนนเฉลี่ย + การกระจาย 1-5 ดาว (สาธารณะ) */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import * as reviewService from "@/services/reviewService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await reviewService.getProductReviewSummary(id));
});
