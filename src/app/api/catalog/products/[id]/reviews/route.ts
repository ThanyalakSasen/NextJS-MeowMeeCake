/** GET /api/catalog/products/[id]/reviews — รีวิวสินค้า (สาธารณะ เห็นเฉพาะ is_visible) ?rating= ?page= ?limit= */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { parseNumber, parsePagination } from "@/lib/queryParams";
import * as reviewService from "@/services/reviewService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const result = await reviewService.listReviews({
    pagination: parsePagination(sp),
    product_id: id,
    rating: parseNumber(sp.get("rating")),
    publicOnly: true,
  });
  return ok(result);
});
