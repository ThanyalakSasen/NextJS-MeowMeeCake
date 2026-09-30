/**
 * POST /api/admin/payments/slips — พนักงานอัปโหลดไฟล์สลิป (payments.create) · multipart/form-data
 *   field: "file" (หรือ "slip") — JPEG / PNG / WEBP / AVIF ≤ 5 MB → public/uploads/slips/
 *   คืน: { url, filename, size } — นำ url ไปใส่ slip_image_url ตอน POST /api/admin/payments (docs/uploads.md)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { readSingleUpload, saveImages, UPLOAD_DIRS } from "@/lib/upload";

export const POST = withPermission("payments", "create", async (_s, req) => {
  const { file } = await readSingleUpload(req, ["file", "slip"]);
  const [saved] = await saveImages([file], UPLOAD_DIRS.slips);
  audit(req, {
    action: `อัปโหลดสลิปโอนเงิน ${saved.filename}`,
    action_type: "CREATE",
    entity: "Payment",
    entity_id: null,
    details: { url: saved.url, size: saved.size },
  });
  return ok(saved);
});
