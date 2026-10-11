/**
 * /api/admin/store-settings — ที่อยู่ร้าน + พิกัด (ย้ายมาจาก /api/owner/store-settings · §8.19) **เจ้าของร้านเท่านั้น**
 *   GET → เอกสารเดียว (ยังไม่มี = สร้างว่างให้)
 *   PUT { house_no?, sub_district?, district?, province?, zip_code? (5 หลัก), latitude?, longitude? (null = ล้าง) }
 *   จังหวัดร้านใช้เป็นขอบเขตจัดส่งของสินค้าที่ส่งทั่วประเทศไม่ได้ (shippingService)
 */
import { ok } from "@/lib/apiResponse";
import { requireRole, withAuth } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as storeService from "@/services/storeService";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  requireRole(session, "owner");
  return ok(await storeService.getSettings());
});

export const PUT = withAuth(async (session, req) => {
  requireRole(session, "owner");
  const body = await req.json().catch(() => null);
  const before = await storeService.getSettings().catch(() => undefined);
  const doc = await storeService.updateSettings(body);
  auditChange(req, {
    op: "update",
    noun: "ที่อยู่ร้าน",
    label: "",
    entity: "StoreSettings",
    entity_id: doc?._id ? String(doc._id) : null,
    before,
    after: doc,
    keys: Object.keys((body as Record<string, unknown> | null) ?? {}),
  });
  return ok(doc);
});
