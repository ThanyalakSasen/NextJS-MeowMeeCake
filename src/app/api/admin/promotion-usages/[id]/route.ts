/** GET /api/admin/promotion-usages/[id] — ดูบันทึกการใช้โปรโมชันรายตัว (promotions.view) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as promotionUsageService from "@/services/promotionUsageService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("promotions", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await promotionUsageService.getUsageById(id));
});
