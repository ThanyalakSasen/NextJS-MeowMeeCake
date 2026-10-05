/**
 * GET /api/catalog/pickup-locations — จุดรับสินค้า (หน้าร้านประจำสัปดาห์ที่เปิดแสดง · สาธารณะ)
 *   คืนแต่ละจุด + order_pickup_dates (วันที่เลือกรับได้ของออเดอร์ปกติ ภายใน 14 วัน · YYYY-MM-DD) + schedule (ข้อความวัน-เวลา)
 *   พรีออเดอร์: วันรับ = ช่วงวันของรอบ เฉพาะวันที่จุดเปิด (src/lib/pickupLocations.ts preorderPickupDateOptions)
 */
import { okList, route } from "@/lib/apiResponse";
import { formatLocationSchedule, orderPickupDateOptions } from "@/lib/pickupLocations";
import * as shippingService from "@/services/shippingService";

export const GET = route(async () => {
  const locations = await shippingService.getActivePickupLocations();
  return okList(
    locations.map((loc) => ({
      ...loc,
      schedule: formatLocationSchedule(loc),
      order_pickup_dates: orderPickupDateOptions(loc),
    }))
  );
});
