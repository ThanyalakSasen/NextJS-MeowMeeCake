/** GET /api/catalog/categories — หมวดหมู่สินค้า (สาธารณะ) ?search= */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { parsePagination } from "@/lib/queryParams";
import { productCategoryService } from "@/services/productCategoryService";

export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const result = await productCategoryService.list({
    pagination: parsePagination(sp, 100),
    search: sp.get("search") ?? undefined,
    sort: { product_category_name: 1 },
  });
  return ok(result);
});
