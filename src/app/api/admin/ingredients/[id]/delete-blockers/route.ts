/** GET /api/admin/ingredients/[id]/delete-blockers — เหตุที่ยังลบวัตถุดิบนี้ไม่ได้ (ingredients.delete) · ว่าง = ลบได้ */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { ingredientService } from "@/services/ingredientService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("ingredients", "delete", async (_s, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await ingredientService.getDeleteBlockers(id));
});
