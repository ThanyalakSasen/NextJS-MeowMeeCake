/**
 * GET /api/admin/shipping-zones/categories — หมวดหมู่สินค้า + ขอบเขตจัดส่งของออเดอร์เว็บ (store_info.view)
 *   ships_nationwide = ค่าที่มีผลจริง · ships_nationwide_auto = ยังไม่เคยตั้ง (เดาจากชื่อหมวด — lib/shipping.ts)
 *   ตั้งค่าที่หน้า "ค่าจัดส่งหน้าร้านออนไลน์" (ย้ายมาจากตัวจัดการหมวดหมู่ในหน้าสินค้า) · แก้ที่ ./[id]
 */
import { okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as shippingService from "@/services/shippingService";

export const GET = withPermission("shipping", "view", async () => okList(await shippingService.listCategoryShipping()));
