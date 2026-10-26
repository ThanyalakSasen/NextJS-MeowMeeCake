/**
 * /api/shop/payments  (การชำระเงินของผู้ใช้ที่ล็อกอินเท่านั้น)
 *   GET  — รายการชำระเงินของตัวเอง (?order_id=&preorder_id=&status=&page=&limit=)
 *   POST — แจ้งชำระเงินของตัวเอง (สถานะเริ่ม pending) — ตรวจด้วย schemas/payment.createPaymentBody
 *          body: { order_id | preorder_id, amount, promptpay_ref?, slip_image_url? }
 *          หรือ multipart/form-data: field "file" (หรือ "slip") + order_id | preorder_id, amount, promptpay_ref?
 *          = สร้างรายการพร้อมสลิปในคำขอเดียว — ใช้แนบสลิปย้อนหลังเปิดออเดอร์ที่หมดเวลาชำระกลับ
 *          เมื่อยังไม่เคยมีรายการชำระเงินมาก่อน (TC-CUS-85 · docs/customer-backend-merge.md §8.8)
 */
import { ok, created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parsePagination } from "@/lib/queryParams";
import { parse, parseBody, parseQuery } from "@/lib/validate";
import { readSingleUpload, UPLOAD_DIRS } from "@/lib/upload";
import { savePrivateImage, deletePrivateFile } from "@/lib/privateFiles";
import { createPaymentBody, listPaymentQuery } from "@/schemas/payment";
import * as paymentService from "@/services/paymentService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  const q = parseQuery(sp, listPaymentQuery);
  const result = await paymentService.listPayments({
    pagination: parsePagination(sp),
    user_id: session.user_id, // ของตัวเองเท่านั้น
    order_id: q.order_id,
    preorder_id: q.preorder_id,
    status: q.status,
  });
  return ok(result);
});

/** multipart: ฟิลด์ข้อความตรวจด้วย schema เดียวกับ JSON (amount มาเป็น string) · slip_image_url มาจากไฟล์ที่อัปโหลดเท่านั้น */
function parseFormFields(form: FormData) {
  const text = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const amount = text("amount");
  return parse(
    {
      order_id: text("order_id"),
      preorder_id: text("preorder_id"),
      amount: amount === undefined ? undefined : Number(amount),
      promptpay_ref: text("promptpay_ref"),
    },
    createPaymentBody
  );
}

export const POST = withAuth(async (session, req) => {
  let body;
  let saved: { url: string; filename: string } | null = null;
  if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const { file, form } = await readSingleUpload(req, ["file", "slip"]);
    body = parseFormFields(form);
    saved = await savePrivateImage(file, UPLOAD_DIRS.slips);
  } else {
    body = await parseBody(req, createPaymentBody);
  }

  let payment;
  try {
    payment = await paymentService.createPayment({
      user_id: session.user_id,
      order_id: body.order_id ?? null,
      preorder_id: body.preorder_id ?? null,
      amount: body.amount,
      promptpay_ref: body.promptpay_ref ?? null,
      slip_image_url: saved?.url ?? body.slip_image_url ?? null,
    });
  } catch (err) {
    // สร้างไม่สำเร็จ (ไม่ใช่ของตัวเอง · ยอดไม่ตรง · ของหมด) → ลบไฟล์ที่เพิ่งเขียน ไม่ให้ค้างเป็นขยะ
    if (saved) await deletePrivateFile(saved.url).catch(() => undefined);
    throw err;
  }
  // BACKLOG §3.5 — เดิมไม่มี audit ฝั่งลูกค้าแจ้งชำระเงินเลย (ครอบแต่ verify/refund/ลบฝั่งแอดมิน)
  audit(req, {
    action: saved ? `แจ้งชำระเงิน (อัปโหลดสลิป ${saved.filename})` : "แจ้งชำระเงิน",
    action_type: "CREATE",
    entity: "Payment",
    entity_id: String((payment as { _id?: unknown })._id ?? ""),
    details: { order_id: body.order_id, preorder_id: body.preorder_id, amount: body.amount },
  });
  return created(payment);
});
