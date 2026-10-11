/**
 * /api/admin/store-profile — ข้อมูลร้าน (ย้ายมาจาก /api/owner/store-profile · customer-backend-merge.md §8.19) **เจ้าของร้านเท่านั้น**
 *   GET → เอกสารร้าน (populate เบอร์โทรหลัก/สำรอง) + system_email (EMAIL_USER · อ่านอย่างเดียว)
 *   PUT JSON { store_name?, promptpay_id?, promptpay_account_name?, contact_email?, social_links?,
 *              phone_primary_user_id?, phone_secondary_user_id?, weekly_markets? }
 *       หรือ multipart { payload: JSON ข้างบน, logo?: ไฟล์รูป ≤ 5 MB (jpg/png/webp/avif) } → อัปโหลดผ่าน src/lib/upload.ts เก็บ logo_url
 */
import { ok } from "@/lib/apiResponse";
import { requireRole, withAuth } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as storeService from "@/services/storeService";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  requireRole(session, "owner");
  return ok(await storeService.getProfile());
});

export const PUT = withAuth(async (session, req) => {
  requireRole(session, "owner");
  let body: unknown;
  let logo: File | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const payload = form.get("payload");
    try {
      body = typeof payload === "string" && payload ? JSON.parse(payload) : {};
    } catch {
      throw badRequest("payload ต้องเป็น JSON");
    }
    const file = form.get("logo");
    if (file instanceof File && file.size > 0) logo = file;
  } else {
    body = await req.json().catch(() => null);
  }
  const before = await storeService.getProfile().catch(() => undefined);
  const doc = await storeService.updateProfile(body, logo);
  auditChange(req, {
    op: "update",
    noun: "ข้อมูลร้าน",
    label: "",
    suffix: logo ? " + โลโก้" : "",
    entity: "StoreProfile",
    entity_id: doc?._id ? String(doc._id) : null,
    before,
    after: doc,
    // weekly_markets มี endpoint ของตัวเอง (log แยก) · โลโก้เปลี่ยน = logo_url ใหม่ บอกในข้อความแทน
    keys: Object.keys((body as Record<string, unknown> | null) ?? {}).filter((k) => k !== "weekly_markets"),
  });
  return ok(doc);
});
