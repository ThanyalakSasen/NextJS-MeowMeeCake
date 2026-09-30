/**
 * /api/shop/payments/[id]/slip — ลูกค้าแนบ/แก้สลิปโอนเงินของตัวเอง (สถานะกลับมา pending รอแอดมินตรวจ)
 *
 *   POST  — อัปโหลดไฟล์สลิป (แนะนำ) · multipart/form-data
 *           field: "file" (หรือ "slip") — JPEG / PNG / WEBP / AVIF ≤ 5 MB · field เสริม: "promptpay_ref"
 *           บันทึกเป็นไฟล์ส่วนตัว (ไม่อยู่ใน public/ — เปิดดูผ่าน GET /api/files/slips/[filename] ที่ตรวจสิทธิ์)
 *           แล้วผูกกับรายการชำระเงินให้ในคำขอเดียว — docs/uploads.md §6
 *   PATCH — body JSON { slip_image_url, promptpay_ref? } (แบบเดิม) — slip_image_url ต้องเป็นไฟล์ที่อัปโหลด
 *           ผ่านระบบแล้วเท่านั้น (/api/files/slips/...) ไม่งั้น 400
 */
import type { NextRequest } from "next/server";
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import type { SessionUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { parseBody, parse } from "@/lib/validate";
import { readSingleUpload, UPLOAD_DIRS } from "@/lib/upload";
import { savePrivateImage, deletePrivateFile } from "@/lib/privateFiles";
import { submitSlipBody } from "@/schemas/payment";
import { objectId } from "@/schemas/common";
import * as paymentService from "@/services/paymentService";

type Ctx = { params: Promise<{ id: string }> };

/** ตรวจ id + เป็นรายการของลูกค้าคนนี้ (ก่อนรับไฟล์ — ไม่ให้อัปโหลดทิ้งไว้ถ้าไม่มีสิทธิ์) */
async function ownPaymentId(session: SessionUser, ctx: Ctx): Promise<string> {
  const id = parse((await ctx.params).id, objectId, "id ของรายการชำระเงิน");
  const payment = await paymentService.getPaymentById(id);
  requireOwner(session, (payment as { user_id?: unknown }).user_id);
  return id;
}

export const POST = withAuth(async (session, req: NextRequest, ctx: Ctx) => {
  const id = await ownPaymentId(session, ctx);
  const { file, form } = await readSingleUpload(req, ["file", "slip"]);
  const promptpayRef = form.get("promptpay_ref");

  const saved = await savePrivateImage(file, UPLOAD_DIRS.slips);
  let result;
  try {
    result = await paymentService.submitSlip(id, {
      slip_image_url: saved.url,
      promptpay_ref: typeof promptpayRef === "string" && promptpayRef.trim() ? promptpayRef.trim().slice(0, 100) : undefined,
    });
  } catch (err) {
    // ผูกไม่สำเร็จ (เช่น รายการ paid ไปแล้ว) → ลบไฟล์ที่เพิ่งเขียน ไม่ให้ค้างเป็นขยะ
    await deletePrivateFile(saved.url).catch(() => undefined);
    throw err;
  }

  audit(req, {
    action: `แนบสลิปโอนเงิน (อัปโหลด ${saved.filename})`,
    action_type: "UPDATE",
    entity: "Payment",
    entity_id: id,
  });
  return ok(result);
});

export const PATCH = withAuth(async (session, req, ctx: Ctx) => {
  const id = await ownPaymentId(session, ctx);
  const body = await parseBody(req, submitSlipBody);
  const result = await paymentService.submitSlip(id, {
    slip_image_url: body.slip_image_url,
    promptpay_ref: body.promptpay_ref ?? undefined,
  });
  // BACKLOG §3.5 — เดิมไม่มี audit ฝั่งลูกค้าแนบสลิปเลย
  audit(req, {
    action: "แนบสลิปโอนเงิน",
    action_type: "UPDATE",
    entity: "Payment",
    entity_id: id,
  });
  return ok(result);
});
