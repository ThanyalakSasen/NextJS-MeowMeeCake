/**
 * /api/admin/products/[id]
 *   GET    — ดูสินค้ารายตัว (products.view)
 *   PATCH  — แก้ไขสินค้า (products.update)
 *   DELETE — ลบสินค้า (products.delete) ; ?hard=true = ลบถาวร
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("products", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await productService.getProductById(id, { includeDeleted }));
});

export const PATCH = withPermission("products", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const result = await productService.updateProduct(id, body);
  audit(req, {
    action: "แก้ไขสินค้า",
    action_type: "UPDATE",
    entity: "Product",
    entity_id: id,
    details: Object.keys(body ?? {}),
  });
  return ok(result);
});

export const DELETE = withPermission("products", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const hard = parseBool(req.nextUrl.searchParams.get("hard")) ?? false;
  const result = hard
    ? await productService.hardDeleteProduct(id)
    : await productService.deleteProduct(id);
  audit(req, {
    action: hard ? "ลบสินค้าถาวร" : "ลบสินค้า",
    action_type: "DELETE",
    entity: "Product",
    entity_id: id,
  });
  return ok(result);
});
