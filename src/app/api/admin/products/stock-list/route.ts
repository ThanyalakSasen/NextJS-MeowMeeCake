/**
 * GET /api/admin/products/stock-list?search=&page=&limit=
 *   รายการสินค้าสำหรับหน้าสต็อกสินค้าหลังร้าน — สินค้าปกติที่ไม่ถูกลบ (ไม่ใช่พรีออเดอร์) · ไม่มี purchase_cost
 *   populate category_id / unit_id ให้แล้ว (ชื่อหมวด + หน่วย) — หน้าสต็อกไม่ต้องเรียก /admin/product-categories · /admin/units
 *   ชุดข้อมูลเดียวกับ GET /api/admin/pos/products (productService.getPosProducts)
 *
 *   สิทธิ์: stock.view — เดิมหน้าสต็อกใช้ /admin/products (products.view) ทำให้คนที่มีแค่สิทธิ์สต็อกเปิดหน้าได้แต่ 403
 *   (frontend Final-Backlog P12) · ปรับยอดยังใช้ PUT /api/admin/products/:id/stock (stock.update) เหมือนเดิม
 */
import { okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parsePagination } from "@/lib/queryParams";
import * as productService from "@/services/productService";

export const GET = withPermission("stock", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await productService.getPosProducts({
    pagination: parsePagination(sp),
    search: sp.get("search") ?? undefined,
  });
  return okList(result.items, result.meta);
});
