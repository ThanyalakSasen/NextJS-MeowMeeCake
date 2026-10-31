/**
 * POST /api/admin/components/[id]/unlink — ยกเลิกการผูกส่วนประกอบกับสูตรหลัก (recipes.update)
 *   body: { recipe_id } · ใช้จาก modal "ลบส่วนประกอบยังไม่ได้"
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { componentUnlinkBody } from "@/schemas/deleteBlockers";
import { unlinkComponent } from "@/services/deleteBlockerActions";
import { componentService } from "@/services/componentService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("recipes", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, componentUnlinkBody);
  const result = await unlinkComponent(id, body.recipe_id);
  const comp = (await componentService.getById(id).catch(() => undefined)) as { component_name?: string } | undefined;
  auditChange(req, {
    op: "update",
    verb: "เอาส่วนประกอบออกจาก",
    noun: "สูตร",
    label: result.label,
    suffix: comp?.component_name ? ` (ส่วนประกอบ "${comp.component_name}")` : "",
    entity: "Recipe",
    entity_id: body.recipe_id,
  });
  return ok(result);
});
