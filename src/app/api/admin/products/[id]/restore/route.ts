/** POST /api/admin/products/[id]/restore — products.update */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("products", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await productService.restoreProduct(id);
  // ระบุชื่อสินค้าในบันทึก (เดิมขึ้นแค่ "กู้คืนสินค้า" ไม่รู้ว่าตัวไหน)
  auditChange(req, {
    op: "restore",
    noun: "สินค้า",
    entity: "Product",
    entity_id: id,
    after: result,
    keys: ["product_name_th", "product_price", "product_stock_quantity"],
  });
  return ok(result);
});
