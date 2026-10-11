/**
 * POST /api/admin/expenses/receipts — อัปโหลดสลิป/ใบเสร็จค่าใช้จ่าย (reports.create) · multipart/form-data
 *   field: "file" (หรือ "receipt") — JPEG / PNG / WEBP / AVIF ≤ 5 MB → **ไฟล์ส่วนตัว** (src/lib/privateFiles.ts)
 *   คืน: { url: "/api/files/receipts/<ไฟล์>", filename, size } — นำ url ไปใส่ receipt_url ตอน POST/PATCH /api/admin/expenses
 *   เปิดดูผ่าน GET /api/files/receipts/[filename] (ต้องมีสิทธิ์ reports.view) · เดิมเก็บใน public/uploads/receipts ใครรู้ URL ก็เปิดได้
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { savePrivateImage } from "@/lib/privateFiles";
import { readSingleUpload, UPLOAD_DIRS } from "@/lib/upload";

export const POST = withPermission("reports", "create", async (_s, req) => {
  const { file } = await readSingleUpload(req, ["file", "receipt"]);
  const saved = await savePrivateImage(file, UPLOAD_DIRS.receipts);
  audit(req, {
    action: `อัปโหลดใบเสร็จค่าใช้จ่าย ${saved.filename}`,
    action_type: "CREATE",
    entity: "Expense",
    entity_id: null,
    details: { url: saved.url, size: saved.size },
  });
  return ok(saved);
});
