/**
 * PATCH /api/admin/orders/[id]/delivery — อัปเดตสถานะจัดส่ง (orders.update)
 *   body: { delivery_status?, tracking_no?, shipped_at?, delivered_at?, delivered_note? }
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as orderService from "@/services/orderService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("orders", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const result = await orderService.updateDelivery(id, body);
  audit(req, {
    action: "อัปเดตสถานะจัดส่ง",
    action_type: "UPDATE",
    entity: "Order",
    entity_id: id,
    details: body,
  });
  return ok(result);
});
