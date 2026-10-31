/**
 * POST /api/admin/ingredients/[id]/unlink — เอาวัตถุดิบออกจากสูตร/ส่วนประกอบ (recipes.update — แก้สูตร)
 *   body: { kind: "recipe" | "component", ref_id } · ใช้จาก modal "ลบวัตถุดิบยังไม่ได้"
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { ingredientUnlinkBody } from "@/schemas/deleteBlockers";
import { unlinkIngredient } from "@/services/deleteBlockerActions";
import { ingredientService } from "@/services/ingredientService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("recipes", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, ingredientUnlinkBody);
  const result = await unlinkIngredient(id, body.kind, body.ref_id);
  const ing = (await ingredientService.getById(id).catch(() => undefined)) as { ingredient_name?: string } | undefined;
  auditChange(req, {
    op: "update",
    verb: "เอาวัตถุดิบออกจาก",
    noun: body.kind === "recipe" ? "สูตร" : "ส่วนประกอบ",
    label: result.label,
    suffix: ing?.ingredient_name ? ` (วัตถุดิบ "${ing.ingredient_name}")` : "",
    entity: body.kind === "recipe" ? "Recipe" : "Component",
    entity_id: body.ref_id,
  });
  return ok(result);
});
