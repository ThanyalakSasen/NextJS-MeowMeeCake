/**
 * POST /api/admin/production-items/[id]/reverse-stock — คืนสต็อกวัตถุดิบที่หักไป (production.approve)
 *   สร้างรายการ receive ชดเชย ; performed_by = ผู้ทำรายการ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as productionItemService from "@/services/productionItemService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("production", "approve", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await productionItemService.reverseStock(id, { performed_by: session.user_id });
  audit(req, {
    action: "คืนสต็อกวัตถุดิบ (รายการผลิต)",
    action_type: "UPDATE",
    entity: "ProductionItem",
    entity_id: id,
  });
  return ok(result);
});
