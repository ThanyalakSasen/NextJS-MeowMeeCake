/**
 * GET /api/admin/products/stock-history — ประวัติสต็อกสินค้า (stock_history / stock .view)
 *   ?product_id= ?type=receive|use|adjust|production|sale|sale_return ?ref_type=order|production_order ?ref_id=
 *   ?date_from= ?date_to= ("YYYY-MM-DD" ตามวันไทย หรือ ISO) ?page= ?limit=
 *   ล่าสุดก่อน · populate สินค้า (ชื่อ/รหัส/หน่วย) + ผู้ทำรายการ · ref_no = เลขออเดอร์/เลขใบสั่งผลิต
 *   บันทึกโดย productService ทุกครั้งที่สต็อกเปลี่ยน (productStockHistoryService)
 */
import { okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
import * as productStockHistoryService from "@/services/productStockHistoryService";

export const GET = withPermission(["stock_history", "stock"], "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await productStockHistoryService.listHistory({
    pagination: parsePagination(sp),
    product_id: sp.get("product_id") ?? undefined,
    type: sp.get("type") ?? undefined,
    ref_type: sp.get("ref_type") ?? undefined,
    ref_id: sp.get("ref_id") ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
  });
  return okList(result.items, result.meta);
});
