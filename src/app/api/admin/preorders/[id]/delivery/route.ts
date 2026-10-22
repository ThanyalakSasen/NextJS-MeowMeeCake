/**
 * PATCH /api/admin/preorders/[id]/delivery — อัปเดตสถานะจัดส่ง (preorder.update)
 *   body: { delivery_status?, tracking_no?, shipping_carrier?, shipped_at?, delivered_at?, delivered_note? }
 *   BACKLOG2 §4 — คู่ขนานกับ PATCH /api/admin/orders/[id]/delivery (เดิมพรีออเดอร์ไม่มี route นี้เลย)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { updateDeliveryBody } from "@/schemas/order";
import * as preorderService from "@/services/preorderService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, updateDeliveryBody);
  const before = await preorderService.getPreorderById(id).catch(() => undefined);
  const result = await preorderService.updateDelivery(id, body);
  auditChange(req, {
    op: "update",
    verb: "อัปเดตการจัดส่ง",
    noun: "พรีออเดอร์",
    entity: "Preorder",
    entity_id: id,
    before,
    after: await preorderService.getPreorderById(id).catch(() => result),
    keys: Object.keys(body ?? {}),
  });
  return ok(result);
});
