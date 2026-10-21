/**
 * GET /api/files/receipts/[filename] — เปิดไฟล์ใบเสร็จค่าใช้จ่าย (ไฟล์ส่วนตัว — src/lib/privateFiles.ts · docs/uploads.md §6)
 *
 * ใบเสร็จเป็นเอกสารการเงินภายในร้าน — เดิมอยู่ใน public/uploads/receipts (ใครรู้ URL ก็เปิดได้)
 * สิทธิ์: พนักงาน/เจ้าของร้านที่มีสิทธิ์ `reports.view` (เมนูเดียวกับหน้าค่าใช้จ่าย · owner ผ่านเสมอ) · ลูกค้าเปิดไม่ได้
 *   ไม่ล็อกอิน → 401 · ไม่มีสิทธิ์ → 403 · ไม่มีไฟล์ → 404 (ตรวจสิทธิ์ก่อนเสมอ — ไม่บอกว่าไฟล์มีหรือไม่ให้คนไม่มีสิทธิ์)
 * ตอบรูปพร้อม Cache-Control: private, no-store (ไม่ให้ proxy/CDN แคช)
 */
import type { NextRequest } from "next/server";
import { route } from "@/lib/apiResponse";
import { authenticate, requirePermission } from "@/lib/authGuard";
import { forbidden, notFound } from "@/lib/httpError";
import { isSafeFilename, readPrivateFile } from "@/lib/privateFiles";
import { UPLOAD_DIRS } from "@/lib/upload";

type Ctx = { params: Promise<{ filename: string }> };

export const GET = route(async (req: NextRequest, ctx: Ctx) => {
  const session = await authenticate(req); // ตรวจบัญชีกับ DB ด้วย (BACKLOG5 Y1)
  await requirePermission(session, ["finance_expenses", "finance_summary"], "view").catch(() => {
    throw forbidden("ไม่มีสิทธิ์เปิดดูใบเสร็จค่าใช้จ่าย");
  });

  const { filename } = await ctx.params;
  if (!isSafeFilename(filename)) throw notFound("ไม่พบไฟล์");
  const file = await readPrivateFile(UPLOAD_DIRS.receipts, filename);
  if (!file) throw notFound("ไม่พบไฟล์");
  return new Response(file.body as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
