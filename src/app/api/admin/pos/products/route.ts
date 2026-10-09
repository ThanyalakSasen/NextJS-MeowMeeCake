/**
 * GET /api/admin/pos/products?search=&page=&limit=
 *   รายการสินค้าที่ขายหน้าร้านได้ (ไม่ลบ · ไม่ใช่พรีออเดอร์) — POS ใช้เป็นคำแนะนำในช่อง "สแกน / ค้นหา"
 *   search ค้นจากรหัสสินค้าหรือชื่อ th/en · เรียงตามชื่อ
 *   คืน: okList ของสินค้า (ไม่มี purchase_cost) + has_customization ต่อรายการ
 *
 *   สิทธิ์: orders.view (พนักงานหน้าร้าน — เดิมต้องใช้ /admin/products ที่ต้องมี products.view · frontend Q-BE10)
 */
import { okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
import * as productService from "@/services/productService";

export const GET = withPermission("orders", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await productService.getPosProducts({
    pagination: parsePagination(sp),
    search: sp.get("search") ?? undefined,
  });
  return okList(result.items, result.meta);
});
