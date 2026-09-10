/**
 * GET /api/catalog/products — รายการสินค้าสำหรับหน้าร้าน (สาธารณะ)
 *   แสดงเฉพาะสินค้าที่ is_visible = true และยังไม่ถูกลบ
 *   ?search=&category_id=&product_type=&page=&limit=&sortBy=&sortOrder=
 *
 *   (การอัปโหลดรูปสินค้าย้ายไป POST /api/admin/products/images — ต้องมีสิทธิ์)
 */
import type { NextRequest } from "next/server";
import { okList, route } from "@/lib/apiResponse";
import * as productService from "@/services/productService";
import type { ProductType } from "@/lib/productCode";

export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const result = await productService.getProducts({
    page: Number(sp.get("page")) || undefined,
    limit: Number(sp.get("limit")) || undefined,
    search: sp.get("search") ?? undefined,
    category_id: sp.get("category_id") ?? undefined,
    product_type: (sp.get("product_type") as ProductType | null) ?? undefined,
    is_visible: true, // หน้าร้านเห็นเฉพาะที่เปิดขาย
    includeDeleted: false,
    sortBy: sp.get("sortBy") ?? undefined,
    sortOrder: (sp.get("sortOrder") as "asc" | "desc" | null) ?? undefined,
  });
  return okList(result.items, result.meta);
});
