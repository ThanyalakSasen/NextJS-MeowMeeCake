/** GET /api/admin/components/[id]/expanded — ส่วนประกอบพร้อม populate วัตถุดิบเต็ม (recipes.view) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { componentService } from "@/services/componentService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("recipes", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await componentService.getExpanded(id));
});
