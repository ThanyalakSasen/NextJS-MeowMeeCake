/**
 * POST /api/shop/orders/delivery-quote — พรีวิวค่าจัดส่งก่อนกดสั่งซื้อ
 *   body: { province }  หรือ  { delivery_address: { province, ... } }
 *   คิดจาก: จังหวัดปลายทาง + ยอดสินค้าในตะกร้าปัจจุบันของผู้ใช้
 *   คืน: { fee, free, zone, free_shipping_min }
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import * as deliveryService from "@/services/deliveryService";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => ({}));
  const province = body.province ?? body.delivery_address?.province ?? null;
  if (!province) throw badRequest("กรุณาระบุ province (หรือ delivery_address.province)");
  return ok(await deliveryService.quoteForCart(session.user_id, { province }));
});
