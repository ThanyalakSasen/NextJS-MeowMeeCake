/**
 * /api/admin/weekly-markets — หน้าร้านประจำสัปดาห์ (ย้ายมาจาก /api/weekly-markets · customer-backend-merge.md §8.19)
 *   owner ผ่านเสมอ · พนักงานใช้สิทธิ์เมนู "store_info" (ข้อมูลร้านส่วนอื่นอยู่ที่ /api/admin/store-profile — owner เท่านั้น)
 *   GET (store_info.view) → { weekly_markets }
 *   PUT { weekly_markets: [...] } แทนที่ทั้งรายการ — ตรวจสิทธิ์ตามสิ่งที่เปลี่ยน: รายการใหม่ = create · แก้/เปิด-ปิด = update ·
 *       หายไป = delete (ขาดสิทธิ์ = 403 บอกว่าขาดอะไร) · มีคนแก้ระหว่างนี้ = 409
 */
import { ok } from "@/lib/apiResponse";
import { withAuth, withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as storeService from "@/services/storeService";

export const dynamic = "force-dynamic";

export const GET = withPermission("store_info", "view", async () => ok(await storeService.getWeeklyMarkets()));

export const PUT = withAuth(async (session, req) => {
  const before = await storeService.getWeeklyMarkets().catch(() => undefined);
  const result = await storeService.updateWeeklyMarkets(session, await req.json().catch(() => null));
  // เทียบรายแถวตามชื่อหน้าร้าน → "weekly_markets[ชื่อ].close_time" (lib/auditDiff)
  auditChange(req, {
    op: "update",
    noun: "หน้าร้านประจำสัปดาห์",
    label: "",
    entity: "StoreProfile",
    before,
    after: await storeService.getWeeklyMarkets().catch(() => result),
    keys: ["weekly_markets"],
  });
  return ok(result);
});
