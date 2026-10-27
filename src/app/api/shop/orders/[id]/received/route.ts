/**
 * POST /api/shop/orders/[id]/received — ลูกค้ากด "ได้รับสินค้าแล้ว" (ออเดอร์แบบจัดส่งที่ร้านจัดส่งแล้ว)
 *   ส่งถึง (delivered) + สำเร็จ (completed · ได้แต้มสะสม) — ร้านอัปเดตได้ถึง "กำลังจัดส่ง" เท่านั้น (lib/orderLifecycle)
 *   ยังไม่จัดส่ง / ยกเลิกแล้ว = 409 · ไม่ใช่แบบจัดส่ง = 400 · ไม่ใช่เจ้าของ = 404
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as orderService from "@/services/orderService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await orderService.confirmReceivedByCustomer(id, session.user_id);
  audit(req, {
    action: "ลูกค้ายืนยันได้รับสินค้า",
    action_type: "UPDATE",
    entity: "Order",
    entity_id: id,
  });
  return ok(result);
});
