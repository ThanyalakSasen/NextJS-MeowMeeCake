/**
 * /api/admin/weekly-markets — หน้าร้านประจำสัปดาห์ (ย้ายมาจาก /api/weekly-markets · customer-backend-merge.md §8.19)
 *   owner ผ่านเสมอ · พนักงานใช้สิทธิ์เมนู "store_info" (ข้อมูลร้านส่วนอื่นอยู่ที่ /api/admin/store-profile — owner เท่านั้น)
 *   GET (store_info.view) → { weekly_markets }
 *   PUT { weekly_markets: [...] } แทนที่ทั้งรายการ — ตรวจสิทธิ์ตามสิ่งที่เปลี่ยน: รายการใหม่ = create · แก้/เปิด-ปิด = update ·
 *       หายไป = delete (ขาดสิทธิ์ = 403 บอกว่าขาดอะไร) · มีคนแก้ระหว่างนี้ = 409
 */
import { ok } from "@/lib/apiResponse";
import { withAuth, withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as storeService from "@/services/storeService";

export const dynamic = "force-dynamic";

export const GET = withPermission("store_info", "view", async () => ok(await storeService.getWeeklyMarkets()));

export const PUT = withAuth(async (session, req) => {
  const result = await storeService.updateWeeklyMarkets(session, await req.json().catch(() => null));
  audit(req, { action: "แก้ไขหน้าร้านประจำสัปดาห์", action_type: "UPDATE", entity: "StoreProfile" });
  return ok(result);
});
