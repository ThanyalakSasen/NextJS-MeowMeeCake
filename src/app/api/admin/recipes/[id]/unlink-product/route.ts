/**
 * POST /api/admin/recipes/[id]/unlink-product — ยกเลิกการผูกสินค้าแล้วลบสูตร (recipes.delete)
 *   สูตรสุดท้ายของสินค้าลบได้ (สินค้าไม่มีสูตรแล้ว) · ยังอยู่ในใบสั่งผลิตค้าง = 409 เหมือนลบปกติ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { recipeService } from "@/services/recipeService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("recipes", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await recipeService.remove(id, { allowLastRecipe: true });
  auditChange(req, {
    op: "delete",
    noun: "สูตร",
    entity: "Recipe",
    entity_id: id,
    before: result,
    keys: ["recipe_name", "product_id"],
    suffix: " (ยกเลิกการผูกสินค้า)",
  });
  return ok(result);
});
