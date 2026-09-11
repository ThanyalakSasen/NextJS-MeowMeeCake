/** POST /api/admin/products/[id]/restore — products.update */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("products", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await productService.restoreProduct(id);
  audit(req, { action: "กู้คืนสินค้า", action_type: "UPDATE", entity: "Product", entity_id: id });
  return ok(result);
});
