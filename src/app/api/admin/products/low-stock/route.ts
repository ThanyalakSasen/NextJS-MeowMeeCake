/** GET /api/admin/products/low-stock — สินค้าที่สต็อกเหลือน้อย (stock.view) ?threshold=5&includeOutOfStock=&limit= */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseBool, parseNumber } from "@/lib/queryParams";
import * as productService from "@/services/productService";

export const GET = withPermission("stock", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(
    await productService.getLowStockProducts(parseNumber(sp.get("threshold")) ?? 5, {
      includeOutOfStock: parseBool(sp.get("includeOutOfStock")) ?? false,
      limit: parseNumber(sp.get("limit")),
    })
  );
});
