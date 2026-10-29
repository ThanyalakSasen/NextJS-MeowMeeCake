/**
 * GET  /api/admin/shipping-zones — โซนค่าส่งของออเดอร์เว็บ (ตามจังหวัด) สำหรับหน้าตั้งค่าหลังร้าน (shipping.view)
 * POST /api/admin/shipping-zones — เพิ่มโซน { zone_label, fee, provinces } (shipping.create · 2026-10-26)
 *   รหัสโซนระบบตั้งให้ (ตัวอักษรถัดไปที่ว่าง ข้าม D) · จังหวัดซ้ำโซนอื่น = 409
 *   ข้อมูลชุดเดียวกับ /api/catalog/shipping-zones (สาธารณะ) · แก้ทีละโซนที่ /api/admin/shipping-zones/:zone_code
 *   ไม่เกี่ยวกับ /api/admin/delivery-zones (ค่าส่ง POS/หลังร้าน — คนละตาราง) · frontend Q-BE2
 */
import { created, okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { shippingZoneCreate } from "@/schemas/shipping";
import * as shippingService from "@/services/shippingService";

export const GET = withPermission("shipping", "view", async () => okList(await shippingService.getShippingZones()));

export const POST = withPermission("shipping", "create", async (_s, req) => {
  const body = await parseBody(req, shippingZoneCreate);
  const zone = await shippingService.createShippingZone(body);
  auditChange(req, { op: "create", noun: "ค่าจัดส่งตามพื้นที่", label: zone.zone_code, entity: "ShippingZone", entity_id: null, after: zone });
  return created(zone);
});
