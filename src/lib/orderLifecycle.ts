/**
 * orderLifecycle — logic ที่ orderService/preorderService ใช้เหมือนกันเป๊ะสำหรับ cancel/payment/
 * delivery/delete (BACKLOG3 §10)
 *
 * preorderModel ถูกออกแบบให้มีฟิลด์ตรงกับ orderModel ทุกจุดที่เกี่ยวกับ lifecycle นี้ตั้งแต่แรก
 * (order_status/payment_status/cancelled_at/cancelled_by/cancelled_reason/delivery_status/
 * shipped_at/delivered_at/tracking_no/delivered_note) — ที่ผ่านมาบั๊กหลายรอบเกิดจาก "แก้ order แล้ว
 * ลืม preorder" ตรงจุดพวกนี้เป๊ะ ๆ ซ้ำแล้วซ้ำอีก (BACKLOG.md §2b — IDOR/auto-refund/auto-confirm/
 * customer-cancel-guard, BACKLOG2.md §4 — updateDelivery หายไปทั้งฟังก์ชัน) รวม logic ที่เหมือนกันจริง
 * ไว้ที่นี่ที่เดียว กันเกิด drift ซ้ำอีกรอบ
 *
 * **ตั้งใจไม่รวม** state-transition orchestration หลัก (`orderService.updateOrderStatus`/
 * `preorderService.updatePreorderStatus`) เพราะ cleanup ตอนยกเลิกต่างกันจริงตามโดเมน (order คืนสต็อก
 * ที่ตัดไปแล้ว + คืนสิทธิ์โปรโมชันที่ใช้ไป, preorder คืนโควตาต่อรายการที่จองไว้ในรอบ) — ฟังก์ชันทั้งสอง
 * ยังคงแยกกันเขียน Saga.onRollback ของตัวเอง แต่เรียก registerAutoRefundOnCancel() ร่วมกันสำหรับส่วนที่
 * เหมือนกันเป๊ะ (auto-refund เมื่อยกเลิกออเดอร์/พรีออเดอร์ที่จ่ายเงินแล้ว)
 */
import type { Model } from "mongoose";
import type { Saga } from "./compensation";
import { badRequest, conflict, notFound } from "./httpError";
import { assertObjectId } from "./objectId";
import dbConnect from "./dbConnect";
import { log } from "./logger";
import paymentModel from "../models/paymentModel";

type AnyModel = Model<unknown>;
type Doc = Record<string, unknown>;

/**
 * ลงทะเบียน auto-refund ใน Saga ถ้า entity จ่ายเงินแล้วตอนกำลังจะถูกยกเลิก (BACKLOG §2.8/§2b.3) —
 * ต้องเรียก**ก่อน** `saga.rollback()` เสมอ (แค่ลงทะเบียน onRollback ไว้ ไม่ได้ refund ทันที)
 */
export async function registerAutoRefundOnCancel(opts: {
  saga: Saga;
  entityKind: "order" | "preorder";
  paymentFilter: Record<string, unknown>; // { order_id } หรือ { preorder_id }
  currentPaymentStatus: string | null | undefined;
  cancelledBy: string | undefined;
  entityId: unknown;
}): Promise<void> {
  if (opts.currentPaymentStatus !== "paid") return;

  const paidPayment = await paymentModel
    .findOne({ ...opts.paymentFilter, status: "paid", deleted_at: null })
    .lean<{ _id: unknown } | null>();

  if (paidPayment && opts.cancelledBy) {
    const verifiedBy = opts.cancelledBy;
    opts.saga.onRollback("auto-refund", async () => {
      // dynamic import — เลี่ยง circular import (paymentService → order/preorderService → lib ตัวนี้)
      const { refundPayment } = await import("../services/paymentService");
      await refundPayment(String(paidPayment._id), { verified_by: verifiedBy });
    });
  } else {
    log.warn(`${opts.entityKind}.auto_refund_skipped`, {
      [`${opts.entityKind}_id`]: String(opts.entityId),
      reason: "ไม่พบ payment ที่ paid หรือไม่มี cancelled_by",
    });
  }
}

/** ตรวจว่าลูกค้ายกเลิกเองได้ไหม (allowedFrom + payment_status ต้องไม่ paid) — throw ถ้าไม่ผ่าน */
export async function assertCustomerCancelAllowed(opts: {
  model: AnyModel;
  id: string;
  allowedFrom: readonly string[];
  /** ชื่อเอนทิตีภาษาไทยสำหรับข้อความ error เช่น "ออเดอร์"/"พรีออเดอร์" */
  entityLabel: string;
}): Promise<void> {
  await dbConnect();
  assertObjectId(opts.id);
  const doc = await opts.model
    .findOne({ _id: opts.id, deleted_at: null })
    .select("order_status payment_status")
    .lean<{ order_status: string; payment_status?: string } | null>();
  if (!doc) throw notFound(`ไม่พบ${opts.entityLabel}ที่ระบุ`);
  if (!opts.allowedFrom.includes(doc.order_status)) {
    throw conflict(
      `ยกเลิก${opts.entityLabel}เองได้เฉพาะตอนสถานะ ${opts.allowedFrom.join(" / ")} เท่านั้น ` +
        `(สถานะปัจจุบัน: "${doc.order_status}") — หากต้องการยกเลิกกรุณาติดต่อร้าน`
    );
  }
  // เอนทิตีที่ชำระเงินแล้ว: ลูกค้ายกเลิกเองไม่ได้ — ต้องให้แอดมินยกเลิก + คืนเงิน (refundPayment)
  // ไม่งั้นจะได้ order_status = cancelled แต่ payment_status ยัง paid โดยไม่มี refund record
  if (doc.payment_status === "paid") {
    throw conflict(
      `${opts.entityLabel}นี้ชำระเงินแล้ว ยกเลิกเองไม่ได้ — กรุณาติดต่อร้านเพื่อขอยกเลิกและคืนเงิน`
    );
  }
}

/**
 * อัปเดต payment_status + auto-confirm เมื่อจ่ายสำเร็จตอนยัง pending (BACKLOG §2b.2) — sync
 * order_status ที่เพิ่ง auto-confirm ลง doc ที่คืนด้วย (ของเดิมทั้งสองฝั่งไม่ sync ทำให้ผลลัพธ์ที่คืน
 * ค้างเป็น "pending" ทั้งที่ DB เพิ่งเปลี่ยนเป็น "confirmed" ไปแล้ว — ไม่กระทบผู้เรียกปัจจุบันเพราะ
 * paymentService.propagateStatus ไม่ได้ใช้ค่าที่คืนกลับมาเลย แต่แก้ให้ถูกไว้กันงงในอนาคต)
 */
export async function setEntityPaymentStatus(opts: {
  model: AnyModel;
  id: string;
  idField: string; // "order_id" | "preorder_id" — ใช้แค่ในข้อความ error ตอน id ผิดรูปแบบ
  status: string;
  statuses: readonly string[];
  paymentId?: string;
  entityLabel: string;
}): Promise<Doc> {
  await dbConnect();
  assertObjectId(opts.id, opts.idField);
  if (!opts.statuses.includes(opts.status)) {
    throw badRequest(`payment_status ต้องเป็นหนึ่งใน: ${opts.statuses.join(", ")}`);
  }
  const set: Record<string, unknown> = { payment_status: opts.status };
  if (opts.paymentId) set.payment_id = opts.paymentId;

  const doc = await opts.model
    .findOneAndUpdate({ _id: opts.id, deleted_at: null }, { $set: set }, { new: true })
    .lean<Doc | null>();
  if (!doc) throw notFound(`ไม่พบ${opts.entityLabel}ที่ระบุ`);

  if (opts.status === "paid" && doc.order_status === "pending") {
    await opts.model.updateOne({ _id: opts.id }, { $set: { order_status: "confirmed" } });
    doc.order_status = "confirmed";
  }
  return doc;
}

/** เช็ค order_type==="delivery" + auto-set shipped_at/delivered_at ถ้ายังไม่มี แล้ว $set payload ที่เหลือ */
export async function applyEntityDeliveryUpdate(opts: {
  model: AnyModel;
  id: string;
  input: Record<string, unknown>;
  entityLabel: string;
}): Promise<Doc | null> {
  await dbConnect();
  assertObjectId(opts.id);

  const doc = await opts.model.findOne({ _id: opts.id, deleted_at: null }).lean<Doc | null>();
  if (!doc) throw notFound(`ไม่พบ${opts.entityLabel}ที่ระบุ`);
  if (doc.order_type !== "delivery") {
    throw badRequest(`${opts.entityLabel}นี้ไม่ใช่ประเภทจัดส่ง (delivery)`);
  }

  const payload: Record<string, unknown> = { ...opts.input };
  if (payload.delivery_status === "shipping" && !doc.shipped_at && !payload.shipped_at) {
    payload.shipped_at = new Date();
  }
  if (payload.delivery_status === "delivered" && !payload.delivered_at) {
    payload.delivered_at = new Date();
  }

  return opts.model
    .findByIdAndUpdate(opts.id, { $set: payload }, { new: true, runValidators: true })
    .lean<Doc | null>();
}

/** soft-delete เอนทิตี + cascade รายการลูก — เฉพาะเมื่อสถานะเป็น completed/cancelled แล้วเท่านั้น */
export async function softDeleteEntityWithItems(opts: {
  model: AnyModel;
  itemModel: AnyModel;
  /** ฟิลด์ FK ของ item model ที่ชี้กลับมา entity นี้ เช่น "order_id"/"preorder_id" */
  itemForeignKey: string;
  id: string;
  entityLabel: string;
}): Promise<{ deleted: true; _id: unknown }> {
  await dbConnect();
  assertObjectId(opts.id);
  const existing = await opts.model
    .findOne({ _id: opts.id, deleted_at: null })
    .select("order_status")
    .lean<{ _id: unknown; order_status: string } | null>();
  if (!existing) throw notFound(`ไม่พบ${opts.entityLabel}ที่ระบุ หรือถูกลบไปแล้ว`);
  if (!["completed", "cancelled"].includes(existing.order_status)) {
    throw conflict(`ลบได้เฉพาะ${opts.entityLabel}ที่เสร็จสิ้นหรือถูกยกเลิกแล้วเท่านั้น`);
  }
  await opts.model.updateOne({ _id: existing._id }, { $set: { deleted_at: new Date() } });
  await opts.itemModel.updateMany(
    { [opts.itemForeignKey]: existing._id, deleted_at: null },
    { $set: { deleted_at: new Date() } }
  );
  return { deleted: true, _id: existing._id };
}
