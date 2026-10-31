/** GET /api/admin/products/[id]/delete-blockers — เหตุที่ยังลบสินค้านี้ไม่ได้ (products.delete) · ว่าง = ลบได้ */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("products", "delete", async (_s, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await productService.getDeleteBlockers(id));
});
