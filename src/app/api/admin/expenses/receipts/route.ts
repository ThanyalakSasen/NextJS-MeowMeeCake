/**
 * POST /api/admin/expenses/receipts — อัปโหลดสลิป/ใบเสร็จค่าใช้จ่าย (reports.create) · multipart/form-data
 *   field: "file" (หรือ "receipt") — JPEG / PNG / WEBP / AVIF ≤ 5 MB → public/uploads/receipts/
 *   คืน: { url, filename, size } — นำ url ไปใส่ receipt_url ตอน POST/PATCH /api/admin/expenses (docs/uploads.md)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { readSingleUpload, saveImages, UPLOAD_DIRS } from "@/lib/upload";

export const POST = withPermission("reports", "create", async (_s, req) => {
  const { file } = await readSingleUpload(req, ["file", "receipt"]);
  const [saved] = await saveImages([file], UPLOAD_DIRS.receipts);
  audit(req, {
    action: `อัปโหลดใบเสร็จค่าใช้จ่าย ${saved.filename}`,
    action_type: "CREATE",
    entity: "Expense",
    entity_id: null,
    details: { url: saved.url, size: saved.size },
  });
  return ok(saved);
});
