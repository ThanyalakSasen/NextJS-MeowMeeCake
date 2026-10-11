/**
 * PATCH /api/admin/orders/[id]/delivery — อัปเดตสถานะจัดส่ง (orders.update)
 *   body: { delivery_status?, tracking_no?, shipped_at?, delivered_at?, delivered_note? }
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { updateDeliveryBody } from "@/schemas/order";
import * as orderService from "@/services/orderService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("orders", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, updateDeliveryBody);
  const before = await orderService.getOrderById(id).catch(() => undefined);
  const result = await orderService.updateDelivery(id, body);
  auditChange(req, {
    op: "update",
    verb: "อัปเดตการจัดส่ง",
    noun: "ออเดอร์",
    entity: "Order",
    entity_id: id,
    before,
    after: await orderService.getOrderById(id).catch(() => result),
    keys: Object.keys(body),
  });
  return ok(result);
});
