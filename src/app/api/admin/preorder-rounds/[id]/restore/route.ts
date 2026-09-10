/** POST /api/admin/preorder-rounds/[id]/restore — กู้คืนรอบที่ถูกลบ (preorder.update) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as preorderRoundService from "@/services/preorderRoundService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const round = await preorderRoundService.restoreRound(id);
  audit(req, {
    action: "กู้คืนรอบพรีออเดอร์",
    action_type: "UPDATE",
    entity: "PreorderRound",
    entity_id: id,
  });
  return ok(round);
});
