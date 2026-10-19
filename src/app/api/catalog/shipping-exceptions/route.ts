/**
 * GET /api/catalog/shipping-exceptions — สินค้าที่ร้านตั้งขอบเขตจัดส่งต่างจากหมวด (สาธารณะ · หน้า "การจัดส่ง" ของลูกค้า)
 *   { nationwide: [...], province_only: [...] } — เฉพาะสินค้าที่เปิดขาย · ตรงกับที่ checkout คิดจริง (quoteStorefrontDelivery)
 */
import { ok, route } from "@/lib/apiResponse";
import * as shippingService from "@/services/shippingService";

export const GET = route(async () => ok(await shippingService.listShippingExceptions()));
