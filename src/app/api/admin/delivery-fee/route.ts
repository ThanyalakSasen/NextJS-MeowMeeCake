/**
 * GET /api/admin/delivery-fee — โครงค่าจัดส่งปัจจุบัน (สิทธิ์ orders.view)
 *   คืน: { free_shipping_min, source: "db"|"env-fallback", zones: [...] }
 *   BACKLOG §3.15 — แก้โซน/ค่าส่งได้จริงผ่าน /api/admin/delivery-zones แล้ว (ไม่ต้องแก้ env+redeploy อีกต่อไป)
 *   ตัวนี้ยังไว้ดูภาพรวมเฉย ๆ (source: "env-fallback" = ยังไม่มีโซนไหนตั้งไว้ใน DB เลย ระบบใช้ค่า
 *   จาก env DELIVERY_FREE_MIN/DELIVERY_FEE_METRO/DELIVERY_FEE_UPCOUNTRY แทน)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as deliveryService from "@/services/deliveryService";

export const GET = withPermission("orders", "view", async () => {
  return ok(await deliveryService.listZones());
});
