/**
 * GET /api/admin/delivery-fee — โครงค่าจัดส่งปัจจุบัน (สิทธิ์ orders.view)
 *   คืน: { free_shipping_min, zones: [{ name, fee }] }
 *   ปรับค่าได้ผ่าน env: DELIVERY_FREE_MIN / DELIVERY_FEE_METRO / DELIVERY_FEE_UPCOUNTRY
 *   (ยังแก้ผ่าน API ไม่ได้ — ดู docs/BACKLOG.md §2.1)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as deliveryService from "@/services/deliveryService";

export const GET = withPermission("orders", "view", async () => {
  return ok(deliveryService.listZones());
});
