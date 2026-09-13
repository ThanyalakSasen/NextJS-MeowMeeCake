/**
 * PATCH /api/admin/preorders/[id]/delivery — อัปเดตสถานะจัดส่ง (preorder.update)
 *   body: { delivery_status?, tracking_no?, shipped_at?, delivered_at?, delivered_note? }
 *   BACKLOG2 §4 — คู่ขนานกับ PATCH /api/admin/orders/[id]/delivery (เดิมพรีออเดอร์ไม่มี route นี้เลย)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { updateDeliveryBody } from "@/schemas/order";
import * as preorderService from "@/services/preorderService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, updateDeliveryBody);
  const result = await preorderService.updateDelivery(id, body);
  audit(req, {
    action: "อัปเดตสถานะจัดส่งพรีออเดอร์",
    action_type: "UPDATE",
    entity: "Preorder",
    entity_id: id,
    details: body,
  });
  return ok(result);
});
