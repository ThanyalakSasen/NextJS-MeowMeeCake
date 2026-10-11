/**
 * /api/admin/products
 *   GET  — รายการสินค้าทั้งหมด (products.view ; เห็นสินค้าที่ซ่อน/ถูกลบด้วยได้)
 *   POST — สร้างสินค้าใหม่ (products.create)
 */
import { okList, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBool, parsePagination } from "@/lib/queryParams";
import * as productService from "@/services/productService";
import { isPreorderFilterFrom } from "@/lib/productCode";

export const GET = withPermission("products", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await productService.getProducts({
    pagination: parsePagination(sp),
    search: sp.get("search") ?? undefined,
    category_id: sp.get("category_id") ?? undefined,
    is_preorder: isPreorderFilterFrom(sp),
    is_visible: parseBool(sp.get("is_visible")),
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
    sortBy: sp.get("sortBy") ?? undefined,
    sortOrder: (sp.get("sortOrder") as "asc" | "desc" | null) ?? undefined,
  });
  return okList(result.items, result.meta);
});

export const POST = withPermission("products", "create", async (_s, req) => {
  const body = await req.json();
  const result: any = await productService.createProduct(body);
  auditChange(req, {
    op: "create",
    noun: "สินค้า",
    entity: "Product",
    entity_id: result?._id ? String(result._id) : null,
    after: result,
    keys: Object.keys(body ?? {}),
  });
  return created(result);
});
