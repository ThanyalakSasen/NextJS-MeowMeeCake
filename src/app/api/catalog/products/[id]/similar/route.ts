/**
 * GET /api/catalog/products/[id]/similar?limit= (1–30 · ค่าเริ่มต้น 6) — สินค้าคล้ายกัน (สาธารณะ · ล็อกอินอยู่ = personalize + เตือนสารก่อภูมิแพ้)
 *   → { recommendations: [{ product, score, reasons, allergenWarning }] } · customer-backend-merge.md §8.15
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { assertObjectId } from "@/lib/objectId";
import { getSession } from "@/lib/session";
import * as recommendationService from "@/services/recommendation/recommendationService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  assertObjectId(id, "product_id");
  const limit = recommendationService.clampLimit(req.nextUrl.searchParams.get("limit"), 6, 30);
  return ok(await recommendationService.similar(id, limit, getSession(req)?.user_id));
});
