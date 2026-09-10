/** GET /api/admin/recipes/[id]/expanded — สูตรพร้อม populate วัตถุดิบ/ส่วนประกอบเต็ม (recipes.view) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { recipeService } from "@/services/recipeService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("recipes", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await recipeService.getExpanded(id));
});
