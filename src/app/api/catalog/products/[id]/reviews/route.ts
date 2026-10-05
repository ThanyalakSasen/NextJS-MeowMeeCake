/**
 * GET /api/catalog/products/[id]/reviews — รีวิวที่แสดงของสินค้า (สาธารณะ) ?rating= ?page= ?limit=
 *   ปักหมุดขึ้นก่อน แล้วใหม่ก่อน · ชื่อผู้รีวิวปิดบางส่วน ("K. Som***") · มีคำตอบของร้าน (shop_reply)
 *   ส่งเฉพาะ field ที่ลูกค้าควรเห็น — ไม่มีแท็ก/โน้ตภายใน (customer-backend-merge.md §8.20)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { parseNumber, parsePagination } from "@/lib/queryParams";
import * as reviewService from "@/services/reviewService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const result = await reviewService.listPublicReviews({
    productId: id,
    pagination: parsePagination(sp),
    rating: parseNumber(sp.get("rating")),
  });
  return ok(result);
});
