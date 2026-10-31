/** GET /api/admin/components/[id]/delete-blockers — สูตรหลักที่ยังใช้ส่วนประกอบนี้ (recipes.delete) · ว่าง = ลบได้ */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { componentService } from "@/services/componentService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("recipes", "delete", async (_s, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await componentService.getDeleteBlockers(id));
});
