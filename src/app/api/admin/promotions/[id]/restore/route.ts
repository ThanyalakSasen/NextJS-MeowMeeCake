/** POST /api/admin/promotions/[id]/restore — กู้คืนโปรโมชันที่ถูกลบ (promotions.update) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as promotionService from "@/services/promotionService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("promotions", "update", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await promotionService.restorePromotion(id));
});
