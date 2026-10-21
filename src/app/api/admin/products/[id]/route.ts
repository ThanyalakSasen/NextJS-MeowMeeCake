/**
 * /api/admin/products/[id]
 *   GET    — ดูสินค้ารายตัว (products.view)
 *   PATCH  — แก้ไขสินค้า (products.update) · ส่ง product_stock_quantity เป็นตัวเลข = 400 → ใช้ ./stock
 *   DELETE — ลบสินค้า (products.delete) ; ?hard=true = ลบถาวร
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission(["products", "pricing", "promotions", "recipes", "production", "preorder", "reports_sales", "search_synonyms"], "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await productService.getProductById(id, { includeDeleted }));
});

export const PATCH = withPermission(["products", "pricing"], "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  // อ่าน keys ก่อน — updateProduct ปรับ input ในตัว (normalizeTypesInput)
  const keys = Object.keys(body ?? {});
  const before = await productService.getProductById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await productService.updateProduct(id, body);
  auditChange(req, { op: "update", noun: "สินค้า", entity: "Product", entity_id: id, before, after: result, keys });
  return ok(result);
});

export const DELETE = withPermission("products", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const hard = parseBool(req.nextUrl.searchParams.get("hard")) ?? false;
  const result = hard
    ? await productService.hardDeleteProduct(id)
    : await productService.deleteProduct(id);
  auditChange(req, {
    op: "delete",
    noun: "สินค้า",
    entity: "Product",
    entity_id: id,
    before: result,
    keys: ["product_name_th", "product_price", "product_stock_quantity"],
    suffix: hard ? " (ถาวร)" : "",
  });
  return ok(result);
});
