/**
 * GET /api/files/slips/[filename] — เปิดไฟล์สลิปโอนเงิน (ไฟล์ส่วนตัว — src/lib/privateFiles.ts · docs/uploads.md §6)
 *
 * สิทธิ์ (BACKLOG4 Y3 — ตัดสินใจ 2026-10-01: เปิดดูได้เฉพาะผู้ได้รับสิทธิ์):
 *   - ลูกค้าเจ้าของรายการชำระเงินที่แนบสลิปนี้
 *   - พนักงาน/เจ้าของร้านที่มีสิทธิ์ `payments.view` (owner ผ่านเสมอ)
 *   ไม่ล็อกอิน → 401 · อื่น ๆ → 403 · ไม่มีไฟล์ → 404 (ตรวจสิทธิ์ก่อนเสมอ — ไม่บอกว่าไฟล์มีหรือไม่ให้คนไม่มีสิทธิ์)
 * ตอบรูปพร้อม Cache-Control: private, no-store (ไม่ให้ proxy/CDN แคช)
 */
import type { NextRequest } from "next/server";
import { route } from "@/lib/apiResponse";
import { requireAuth, requirePermission } from "@/lib/authGuard";
import { forbidden, notFound } from "@/lib/httpError";
import dbConnect from "@/lib/dbConnect";
import { PRIVATE_URL_PREFIX, isSafeFilename, readPrivateFile } from "@/lib/privateFiles";
import { UPLOAD_DIRS } from "@/lib/upload";
import paymentModel from "@/models/paymentModel";

type Ctx = { params: Promise<{ filename: string }> };

export const GET = route(async (req: NextRequest, ctx: Ctx) => {
  const session = requireAuth(req);
  const { filename } = await ctx.params;
  if (!isSafeFilename(filename)) throw notFound("ไม่พบไฟล์");

  await dbConnect();
  const url = `${PRIVATE_URL_PREFIX}/${UPLOAD_DIRS.slips}/${filename}`;
  const payment = await paymentModel
    .findOne({ slip_image_url: url, deleted_at: null })
    .select("user_id")
    .lean<{ user_id: unknown } | null>();

  const isOwner = payment && String(payment.user_id) === session.user_id;
  if (!isOwner) {
    // ไม่ใช่เจ้าของ (รวมสลิปที่ยังไม่ผูกกับรายการใด — อัปโหลดโดยพนักงาน) → ต้องมีสิทธิ์ดูการชำระเงิน
    await requirePermission(session, "payments", "view").catch(() => {
      throw forbidden("ไม่มีสิทธิ์เปิดดูสลิปนี้");
    });
  }

  const file = await readPrivateFile(UPLOAD_DIRS.slips, filename);
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
