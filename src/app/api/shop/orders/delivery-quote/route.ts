/**
 * POST /api/shop/orders/delivery-quote — พรีวิวค่าจัดส่งก่อนกดสั่งซื้อ (หน้าเว็บลูกค้า)
 *   body: { province } หรือ { delivery_address: { province, ... } } · product_ids? (ไม่ส่ง = สินค้าในตะกร้าปัจจุบัน
 *         · พรีออเดอร์ส่ง product_ids ของรายการในรอบมาเอง)
 *   คิดจาก ShippingZones ตามจังหวัด + ขอบเขตจัดส่ง (หมวดที่ไม่ส่งทั่วประเทศ → เฉพาะจังหวัดร้าน)
 *   — ตรงกับที่ POST /api/shop/orders และ /api/shop/preorders คิดจริง (docs/customer-backend-merge.md §8.7)
 *   คืน: { deliverable, message, fee, free, zone, zone_code, free_shipping_min: null }
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { badRequest, isHttpError } from "@/lib/httpError";
import { isObjectId } from "@/lib/objectId";
import * as cartService from "@/services/cartService";
import * as shippingService from "@/services/shippingService";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => ({}));
  const province = body.province ?? body.delivery_address?.province ?? null;
  if (!province) throw badRequest("กรุณาระบุ province (หรือ delivery_address.province)");

  const productIds: string[] = Array.isArray(body.product_ids)
    ? body.product_ids.filter(isObjectId).slice(0, 100)
    : (await cartService.getCartDetail(session.user_id)).items.map((it: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
        String(it.product_id?._id ?? it.product_id)
      );

  try {
    const quote = await shippingService.quoteStorefrontDelivery({ province, productIds });
    return ok({
      deliverable: true,
      message: null,
      fee: quote.fee,
      free: quote.fee === 0,
      zone: quote.zone_label,
      zone_code: quote.zone_code,
      free_shipping_min: null, // ออเดอร์เว็บไม่มีส่งฟรีตามยอด (ส่งฟรีจากโปรโมชันเท่านั้น)
    });
  } catch (err) {
    // ส่งไปจังหวัดนี้ไม่ได้ (สินค้าส่งเฉพาะจังหวัดร้าน) — พรีวิวตอบเป็นข้อมูล ไม่ใช่ error
    if (isHttpError(err) && err.status === 400) {
      return ok({ deliverable: false, message: err.message, fee: null, free: false, zone: null, zone_code: null, free_shipping_min: null });
    }
    throw err;
  }
});
