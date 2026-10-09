/**
 * GET /api/admin/shipping-zones — โซนค่าส่งของออเดอร์เว็บ (A–D ตามจังหวัด) สำหรับหน้าตั้งค่าหลังร้าน (store_info.view)
 *   ข้อมูลชุดเดียวกับ /api/catalog/shipping-zones (สาธารณะ) · แก้ทีละโซนที่ /api/admin/shipping-zones/:zone_code
 *   ไม่เกี่ยวกับ /api/admin/delivery-zones (ค่าส่ง POS/หลังร้าน — คนละตาราง) · frontend Q-BE2
 */
import { okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as shippingService from "@/services/shippingService";

export const GET = withPermission("store_info", "view", async () => okList(await shippingService.getShippingZones()));
