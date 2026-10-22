/**
 * /api/admin/shipping-zones — โซนค่าส่งของออเดอร์เว็บ (ตามจังหวัด) สำหรับหน้าตั้งค่าหลังร้าน
 *   GET  (store_info.view)   ข้อมูลชุดเดียวกับ /api/catalog/shipping-zones (สาธารณะ) · โซนสำรอง D อยู่ท้ายสุด
 *   POST (store_info.create) { zone_label, fee, provinces? } → โซนใหม่ (รหัสตัวอักษรถัดไปที่ว่าง · จังหวัดซ้ำโซนอื่น = 409)
 *   แก้/ลบทีละโซนที่ /api/admin/shipping-zones/:zone_code
 *   ไม่เกี่ยวกับ /api/admin/delivery-zones (ค่าส่ง POS/หลังร้าน — คนละตาราง) · frontend Q-BE2
 */
import { created, okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { shippingZoneCreate } from "@/schemas/shipping";
import * as shippingService from "@/services/shippingService";

export const GET = withPermission("store_info", "view", async () => okList(await shippingService.getShippingZones()));

export const POST = withPermission("store_info", "create", async (_s, req) => {
  const body = await parseBody(req, shippingZoneCreate);
  const zone = await shippingService.createShippingZone(body);
  auditChange(req, {
    op: "create",
    noun: "ค่าส่งเว็บ โซน",
    label: zone.zone_code,
    entity: "ShippingZone",
    entity_id: null,
    before: null,
    after: zone,
    keys: ["zone_label", "fee", "provinces"],
  });
  return created(zone);
});
