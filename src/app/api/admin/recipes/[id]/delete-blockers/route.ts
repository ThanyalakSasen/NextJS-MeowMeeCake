/** GET /api/admin/recipes/[id]/delete-blockers — เหตุที่ยังลบสูตรนี้ไม่ได้ (recipes.delete) · ว่าง = ลบได้ */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { recipeService } from "@/services/recipeService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("recipes", "delete", async (_s, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await recipeService.getDeleteBlockers(id));
});
