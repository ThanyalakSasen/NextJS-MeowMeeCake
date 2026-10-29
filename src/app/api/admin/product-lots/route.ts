/**
 * GET /api/admin/product-lots — ล็อตสินค้าที่ผลิตเสร็จ (production / stock / pos .view)
 *   ?product_id= ?production_order_id= ?search= (เลขล็อต) ?in_stock=true (เหลือของ) ?page= ?limit=
 *   แต่ละล็อตมี expiry_state (expired | expiring | ok | none) — productLotService
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseBool, parsePagination } from "@/lib/queryParams";
import * as productLotService from "@/services/productLotService";

export const GET = withPermission(["production", "stock", "pos"], "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await productLotService.listLots({
    pagination: parsePagination(sp),
    product_id: sp.get("product_id") ?? undefined,
    production_order_id: sp.get("production_order_id") ?? undefined,
    search: sp.get("search") ?? undefined,
    in_stock: parseBool(sp.get("in_stock")) ?? false,
  });
  return ok(result);
});
