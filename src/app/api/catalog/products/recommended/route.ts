/**
 * GET /api/catalog/products/recommended — สินค้าแนะนำหน้าแรก (สาธารณะ · ล็อกอินอยู่ = personalize)
 *   → { products } 10 ชิ้น · ไม่ล็อกอิน/คำนวณไม่สำเร็จ = เรียงตามคะแนนรีวิว (customer-backend-merge.md §8.15)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { getSession } from "@/lib/session";
import * as recommendationService from "@/services/recommendation/recommendationService";

export const GET = route(async (req: NextRequest) => {
  const session = getSession(req);
  return ok(await recommendationService.recommendedProducts(session?.user_id ?? null));
});
