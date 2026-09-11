/** GET /api/admin/ingredients/[id]/stock — ยอดคงเหลือปัจจุบันของวัตถุดิบ (ingredients.view) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { ingredientService } from "@/services/ingredientService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("ingredients", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok({ ingredient_id: id, current_stock: await ingredientService.getStock(id) });
});
