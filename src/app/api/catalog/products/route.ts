/**
 * GET /api/catalog/products — รายการสินค้าสำหรับหน้าร้าน (สาธารณะ)
 *   แสดงเฉพาะสินค้าที่ is_visible = true และยังไม่ถูกลบ
 *   ?search=&category_id=&is_preorder=true|false&page=&limit=&sortBy=&sortOrder=
 *   (?product_type=preorder|inStore|online แบบเดิมยังรับได้ — แปลงเป็น is_preorder)
 *
 *   (การอัปโหลดรูปสินค้าย้ายไป POST /api/admin/products/images — ต้องมีสิทธิ์)
 */
import type { NextRequest } from "next/server";
import { okList, route } from "@/lib/apiResponse";
import { parsePagination } from "@/lib/queryParams";
import * as productService from "@/services/productService";
import { isPreorderFilterFrom } from "@/lib/productCode";

export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const result = await productService.getProducts({
    pagination: parsePagination(sp),
    search: sp.get("search") ?? undefined,
    category_id: sp.get("category_id") ?? undefined,
    is_preorder: isPreorderFilterFrom(sp),
    is_visible: true, // หน้าร้านเห็นเฉพาะที่เปิดขาย
    includeDeleted: false,
    sortBy: sp.get("sortBy") ?? undefined,
    sortOrder: (sp.get("sortOrder") as "asc" | "desc" | null) ?? undefined,
  });
  return okList(result.items, result.meta);
});
