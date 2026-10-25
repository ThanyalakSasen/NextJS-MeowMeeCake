/**
 * PATCH  /api/admin/shipping-zones/:zone_code — แก้โซนค่าส่งเว็บ (store_info.update · frontend Q-BE2)
 * DELETE /api/admin/shipping-zones/:zone_code — ลบโซน (store_info.delete) · โซน D (จังหวัดที่เหลือ) ลบไม่ได้
 *   body { zone_label?, fee?, provinces? } อย่างน้อย 1 ฟิลด์
 *   - provinces ต้องเป็นชื่อทางการใน 77 จังหวัด · ซ้ำกับโซนอื่น = 409 · โซน D ใส่จังหวัดไม่ได้ (เป็นโซนที่เหลือทั้งหมด)
 *   - fee เป็นบาท ≥ 0
 *   เขียน audit log (before/after) แบบ endpoint ตั้งค่าอื่น
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { shippingZoneUpdate } from "@/schemas/shipping";
import * as shippingService from "@/services/shippingService";

type Ctx = { params: Promise<{ zone_code: string }> };

export const PATCH = withPermission("shipping", "update", async (_s, req, ctx: Ctx) => {
  const { zone_code } = await ctx.params;
  const body = await parseBody(req, shippingZoneUpdate);
  const { before, after } = await shippingService.updateShippingZone(zone_code.toUpperCase(), body);
  auditChange(req, {
    op: "update",
    noun: "ค่าส่งเว็บ โซน",
    label: after.zone_code,
    entity: "ShippingZone",
    entity_id: null,
    before,
    after,
    keys: Object.keys(body),
  });
  return ok(after);
});

export const DELETE = withPermission("shipping", "delete", async (_s, req, ctx: Ctx) => {
  const { zone_code } = await ctx.params;
  const removed = await shippingService.deleteShippingZone(zone_code.toUpperCase());
  auditChange(req, {
    op: "delete",
    noun: "ค่าส่งเว็บ โซน",
    label: removed.zone_code,
    entity: "ShippingZone",
    entity_id: null,
    before: removed,
    after: null,
    keys: ["zone_label", "fee", "provinces"],
  });
  return ok({ deleted: removed.zone_code });
});
