/**
 * /api/admin/ingredient-transactions/[id]
 *   GET    — ดูรายการเคลื่อนไหวรายตัว (ingredients.view)
 *   DELETE — ยกเลิกรายการ + ย้อนผลต่อสต็อก (ingredients.delete ; use/receive เท่านั้น)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as txnService from "@/services/ingredientTransactionService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("ingredients", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await txnService.getTransactionById(id));
});

export const DELETE = withPermission("ingredients", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await txnService.voidTransaction(id);
  audit(req, {
    action: "ยกเลิกรายการเคลื่อนไหวสต็อกวัตถุดิบ",
    action_type: "DELETE",
    entity: "IngredientTransaction",
    entity_id: id,
  });
  return ok(result);
});
