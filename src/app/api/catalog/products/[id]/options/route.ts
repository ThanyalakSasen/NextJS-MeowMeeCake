/** GET /api/catalog/products/[id]/options — ตัวเลือกเสริม (option) ของสินค้านี้ (สาธารณะ) */
import type { NextRequest } from "next/server";
import { okList, route } from "@/lib/apiResponse";
import { productOptionService } from "@/services/productOptionService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await productOptionService.list({
    pagination: { page: 1, limit: 100, skip: 0 },
    sort: { created_at: 1 },
    filter: { product_id: id },
  });
  return okList(result.items);
});
