/**
 * PATCH /api/shop/orders/[id]/delivery — ลูกค้าแก้วิธีรับสินค้า / ที่อยู่จัดส่ง / จุดรับ ของออเดอร์ที่ยังไม่ชำระ (เลขบิลเดิม)
 *   body: { order_type, address_id + recipient_name + recipient_phone | delivery_address, pickup_location_id?, pickup_date? }
 *   ค่าส่ง + ยอดรวมคิดใหม่ฝั่ง server · เงื่อนไขที่แก้ได้ดู services/billDeliveryService.ts
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { editBillDeliveryBody } from "@/schemas/billDelivery";
import { editBillDelivery } from "@/services/billDeliveryService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, editBillDeliveryBody);
  const bill = await editBillDelivery(session.user_id, "order", id, body);
  audit(req, {
    action: "ลูกค้าแก้วิธีรับสินค้าออเดอร์",
    action_type: "UPDATE",
    entity: "Order",
    entity_id: id,
    details: { order_type: body.order_type, total_amount: bill?.total_amount },
  });
  return ok(bill);
});
