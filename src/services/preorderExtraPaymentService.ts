// ─────────────────────────────────────────────────────────────
// preorderExtraPaymentService — ยอด "รอชำระเพิ่ม" ของพรีออเดอร์ที่ชำระแล้ว (ผู้ใช้ขอ 2026-11-03)
//
// ร้านเปลี่ยนสินค้าแล้วยอดใหม่เกินยอดที่ลูกค้าชำระไว้ (ยืนยันแล้วในหน้าจอ) → preorder.extra_due_amount = ส่วนต่าง
// + payment ใบใหม่ (is_extra: true, pending) ให้ลูกค้าโอน/แนบสลิปที่หน้าคำสั่งซื้อเดิม
//   - payment_status ของใบคงเป็น "paid" (ยอดเดิมรับแล้ว) — ใบที่ชำระแล้วไม่ถูกยกเลิกอัตโนมัติเพราะยอดเพิ่ม
//   - ยืนยันสลิปยอดเพิ่ม → หัก extra_due_amount · ปฏิเสธ → แจ้งลูกค้าอัปโหลดใหม่ (สถานะใบไม่เปลี่ยน)
//   - ยอดเปลี่ยนอีกรอบ: เพิ่ม → หัก "รอโอนคืน" ก่อน เหลือเป็นรอชำระเพิ่ม · ลด → หักรอชำระเพิ่มก่อน เหลือเป็นรอโอนคืน
// ─────────────────────────────────────────────────────────────
import { round2 } from "../lib/money";
import { log } from "../lib/logger";
import paymentModel from "../models/paymentModel";
import preorderModel from "../models/preorderModel";
import { customerMessages, customerWeb, notifyCustomerLater } from "./customerNotifyService";
import { clearRevertIfSettled, revertExpiredExtraEdits } from "./preorderExtraRevertService";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * แบ่งยอดที่เปลี่ยน (ใบที่ชำระแล้ว · delta = ยอดสุทธิใหม่ − เดิม) เป็นส่วนที่เพิ่ม/ลดของ refund_due กับ extra_due
 * — สองยอดไม่ค้างพร้อมกัน (ร้านไม่ต้องโอนคืนแล้วเรียกเก็บเพิ่มในใบเดียวกัน)
 */
export function splitPaidDelta(
  p: { refund_due_amount?: number | null; extra_due_amount?: number | null },
  delta: number
): { refundInc: number; extraInc: number } {
  const refundDue = Number(p.refund_due_amount ?? 0);
  const extraDue = Number(p.extra_due_amount ?? 0);
  if (delta > 0) {
    const fromRefund = Math.min(refundDue, delta);
    return { refundInc: round2(-fromRefund), extraInc: round2(delta - fromRefund) };
  }
  const d = -delta;
  const fromExtra = Math.min(extraDue, d);
  return { refundInc: round2(d - fromExtra), extraInc: round2(-fromExtra) };
}

/**
 * ให้ payment ยอดเพิ่มตรงกับ extra_due_amount ปัจจุบัน — มียอด = แก้ใบที่ยังไม่ยืนยัน (ไม่มีสลิปรอตรวจ) หรือสร้างใหม่
 * · ยอดเป็น 0 = ลบใบที่ยังไม่มีสลิปทิ้ง · ใบที่มีสลิปรอตรวจไม่แตะ (หน้าเปลี่ยนสินค้ากันไว้ก่อนแล้ว)
 */
export async function syncExtraPayment(preorderId: unknown): Promise<void> {
  const p = await preorderModel.findById(preorderId).select("user_id extra_due_amount").lean<any>();
  if (!p) return;
  const due = round2(Number(p.extra_due_amount ?? 0));
  const open = { preorder_id: p._id, is_extra: true, deleted_at: null, status: { $in: ["pending", "failed"] } };
  if (due <= 0) {
    await paymentModel.updateMany(
      { ...open, slip_image_url: { $in: [null, ""] } },
      { $set: { deleted_at: new Date() } }
    );
    return;
  }
  const updated = await paymentModel.updateMany(
    { ...open, $or: [{ status: "failed" }, { slip_image_url: { $in: [null, ""] } }] },
    { $set: { amount: due } }
  );
  if (updated.matchedCount > 0) return;
  if (await paymentModel.exists({ preorder_id: p._id, status: "pending", deleted_at: null })) return;
  try {
    await paymentModel.create({ preorder_id: p._id, user_id: p.user_id, amount: due, status: "pending", is_extra: true });
  } catch (err: any) {
    // สร้างชนกัน (unique pending ต่อพรีออเดอร์) = มีใบอยู่แล้ว
    if (err?.code !== 11000) throw err;
  }
}

/** ผลตรวจสลิปของ payment ยอดเพิ่ม — paid หัก extra_due · failed แจ้งให้อัปโหลดใหม่ · refunded ไม่แตะใบ */
export async function onExtraPaymentStatus(payment: any, status: string): Promise<void> {
  if (status !== "paid" && status !== "failed") return;
  const amount = round2(Number(payment.amount ?? 0));
  if (status === "paid") {
    await preorderModel.updateOne({ _id: payment.preorder_id }, { $inc: { extra_due_amount: -amount } });
    // ปัดเศษทศนิยมที่ค้างจาก $inc + กันติดลบ (ยอดสลิปตรงกับยอดค้างเสมอ — ใบเดียวต่อครั้ง)
    await preorderModel.updateOne({ _id: payment.preorder_id, extra_due_amount: { $lt: 0.005 } }, { $set: { extra_due_amount: 0 } });
    await clearRevertIfSettled(payment.preorder_id);
  } else {
    // สลิปถูกปฏิเสธหลังหมดเวลาชำระส่วนต่าง = คืนรายการเดิมทันที (ยังไม่หมดเวลา = แนบใหม่ได้)
    await revertExpiredExtraEdits({ preorderId: String(payment.preorder_id) });
  }
  const p = await preorderModel.findById(payment.preorder_id).lean<any>();
  if (!p) {
    log.warn("preorder.extra_payment_orphan", { payment_id: String(payment._id) });
    return;
  }
  const text = customerMessages.preorderExtraPayment(p.preorder_no, status, amount);
  notifyCustomerLater(p.user_id, text, customerWeb.fromLineText("preorder", p._id, p.preorder_no, text, status === "paid" ? "success" : "warning"));
}
