/**
 * GET /api/admin/products/low-stock — สินค้าที่สต็อกเหลือน้อย (stock.view) ?threshold=&includeOutOfStock=&limit=
 *   ไม่ส่ง threshold = ใช้เกณฑ์ของแต่ละสินค้า (low_stock_threshold ?? 5) · ส่งตัวเลข = ใช้เกณฑ์เดียวกันทุกสินค้า
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseBool, parseNumber } from "@/lib/queryParams";
import * as productService from "@/services/productService";

export const GET = withPermission("stock", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(
    await productService.getLowStockProducts(parseNumber(sp.get("threshold")), {
      includeOutOfStock: parseBool(sp.get("includeOutOfStock")) ?? false,
      limit: parseNumber(sp.get("limit")),
    })
  );
});
