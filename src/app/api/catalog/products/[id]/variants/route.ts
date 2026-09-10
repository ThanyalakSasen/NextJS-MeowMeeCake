/** GET /api/catalog/products/[id]/variants — ตัวเลือกสินค้า (variant) ของสินค้านี้ (สาธารณะ) */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { productVariantService } from "@/services/productVariantService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await productVariantService.list({
    pagination: { page: 1, limit: 100, skip: 0 },
    sort: { created_at: 1 },
    filter: { product_id: id },
  });
  return ok(result.items);
});
