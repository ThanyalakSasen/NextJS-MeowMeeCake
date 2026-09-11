/** GET /api/catalog/products/[id]/sentiment — สรุปความรู้สึกรายแง่มุมของสินค้า (สาธารณะ) */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import * as sentimentService from "@/services/sentimentService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await sentimentService.getProductAspectSummary(id));
});
