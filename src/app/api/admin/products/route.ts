/**
 * /api/admin/products
 *   GET  — รายการสินค้าทั้งหมด (products.view ; เห็นสินค้าที่ซ่อน/ถูกลบด้วยได้)
 *   POST — สร้างสินค้าใหม่ (products.create)
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import * as productService from "@/services/productService";
import type { ProductType } from "@/lib/productCode";

export const GET = withPermission("products", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await productService.getProducts({
    page: Number(sp.get("page")) || undefined,
    limit: Number(sp.get("limit")) || undefined,
    search: sp.get("search") ?? undefined,
    category_id: sp.get("category_id") ?? undefined,
    product_type: (sp.get("product_type") as ProductType | null) ?? undefined,
    is_visible: parseBool(sp.get("is_visible")),
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
    sortBy: sp.get("sortBy") ?? undefined,
    sortOrder: (sp.get("sortOrder") as "asc" | "desc" | null) ?? undefined,
  });
  return ok(result);
});

export const POST = withPermission("products", "create", async (_s, req) => {
  const body = await req.json();
  const result: any = await productService.createProduct(body);
  audit(req, {
    action: `สร้างสินค้า ${result?.product_id ?? ""}`.trim(),
    action_type: "CREATE",
    entity: "Product",
    entity_id: result?._id ? String(result._id) : null,
    details: { name: body.product_name_th, product_type: body.product_type, price: body.product_price },
  });
  return created(result);
});
