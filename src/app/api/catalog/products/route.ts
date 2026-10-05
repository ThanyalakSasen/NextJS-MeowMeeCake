/**
 * GET /api/catalog/products — รายการสินค้าสำหรับหน้าร้าน (สาธารณะ)
 *   แสดงเฉพาะสินค้าที่ is_visible = true และยังไม่ถูกลบ
 *   ?search=&category_id=&is_preorder=true|false&page=&limit=&sortBy=&sortOrder=
 *   sortBy: created_at | product_name_th | product_name_eng | product_price | avg_rating | review_count (อื่น = 400)
 *   ส่งเฉพาะ field สาธารณะ (ไม่มีต้นทุน/field ภายใน — src/lib/publicProduct.ts · docs/BACKLOG5.md R1)
 *   search ขยายด้วยคำพ้องค้นหาที่ร้านตั้ง (เช่น "chocolate" เจอ "เค้กช็อกโกแลต" — customer-backend-merge.md §8.16)
 *   (?product_type=preorder|inStore|online แบบเดิมยังรับได้ — แปลงเป็น is_preorder)
 *
 *   (การอัปโหลดรูปสินค้าย้ายไป POST /api/admin/products/images — ต้องมีสิทธิ์)
 */
import type { NextRequest } from "next/server";
import { okList, route } from "@/lib/apiResponse";
import { parsePagination } from "@/lib/queryParams";
import * as productService from "@/services/productService";
import { isPreorderFilterFrom } from "@/lib/productCode";
import { PUBLIC_PRODUCT_SORTS, toPublicProduct } from "@/lib/publicProduct";

export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const result = await productService.getProducts({
    pagination: parsePagination(sp),
    search: sp.get("search") ?? undefined,
    expandSynonyms: true,
    category_id: sp.get("category_id") ?? undefined,
    is_preorder: isPreorderFilterFrom(sp),
    is_visible: true, // หน้าร้านเห็นเฉพาะที่เปิดขาย
    includeDeleted: false,
    sortBy: sp.get("sortBy") ?? undefined,
    sortOrder: (sp.get("sortOrder") as "asc" | "desc" | null) ?? undefined,
    sortable: PUBLIC_PRODUCT_SORTS,
  });
  return okList(result.items.map(toPublicProduct), result.meta);
});
