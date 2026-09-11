/**
 * paymentService — การชำระเงิน (Payments) แบบโอน/พร้อมเพย์ + แนบสลิป + แอดมินตรวจสอบ
 *
 * flow:
 *   createPayment (pending) → submitSlip (แนบสลิป, ยัง pending)
 *     → verifyPayment(approved=true)  → status "paid"    + อัปเดต payment_status ของ order/preorder
 *     → verifyPayment(approved=false) → status "failed"   + อัปเดต payment_status
 *     → refundPayment                 → status "refunded" + อัปเดต payment_status
 *
 * 1 payment ผูกกับ order_id หรือ preorder_id อย่างใดอย่างหนึ่ง
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId, isObjectId } from "../lib/objectId";
import { assertRefExists } from "../lib/refs";
import { buildMeta, type Pagination } from "../lib/queryParams";
import paymentModel from "../models/paymentModel";
import orderModel from "../models/orderModel";
import preorderModel from "../models/preorderModel";
import userModel from "../models/userModel";
import { notificationService } from "./notificationService";
import { log } from "../lib/logger";
import * as orderService from "./orderService";
import type { PaymentStatus } from "./orderService";

/* eslint-disable @typescript-eslint/no-explicit-any */

const AMOUNT_TOLERANCE = 0.01;

export interface CreatePaymentInput {
  user_id: string;
  order_id?: string | null;
  preorder_id?: string | null;
  amount: number;
  promptpay_ref?: string | null;
  slip_image_url?: string | null;
}

export interface ListPaymentQuery {
  pagination: Pagination;
  user_id?: string;
  order_id?: string;
  preorder_id?: string;
  status?: PaymentStatus;
  date_from?: string;
  date_to?: string;
  includeDeleted?: boolean;
}

// ── helper: ผลักสถานะไปที่ order หรือ preorder ที่ผูกไว้ ─────
async function propagateStatus(payment: any, status: PaymentStatus) {
  if (payment.order_id) {
    await orderService.setPaymentStatus(String(payment.order_id), status, String(payment._id));
  } else if (payment.preorder_id) {
    await preorderModel.updateOne(
      { _id: payment.preorder_id, deleted_at: null },
      { $set: { payment_status: status, payment_id: payment._id } }
    );
  }
}

// ── CREATE ──────────────────────────────────────────────────
export async function createPayment(input: CreatePaymentInput) {
  await dbConnect();

  if (!input.user_id) throw badRequest("กรุณาระบุ user_id");
  await assertRefExists(userModel, input.user_id, "ผู้ใช้", "user_id");

  const hasOrder = !!input.order_id;
  const hasPreorder = !!input.preorder_id;
  if (hasOrder === hasPreorder) {
    throw badRequest("ต้องระบุ order_id หรือ preorder_id อย่างใดอย่างหนึ่ง");
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest("amount ต้องเป็นตัวเลขมากกว่า 0");
  }

  if (hasOrder) {
    assertObjectId(input.order_id as string, "order_id");
    const order = await orderModel
      .findOne({ _id: input.order_id, deleted_at: null })
      .lean<any>();
    if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ");
    if (String(order.user_id) !== String(input.user_id)) {
      throw badRequest("ออเดอร์นี้ไม่ได้เป็นของผู้ใช้ที่ระบุ");
    }
    if (order.payment_status === "paid") throw conflict("ออเดอร์นี้ชำระเงินแล้ว");
    if (order.order_status === "cancelled") throw conflict("ออเดอร์นี้ถูกยกเลิกแล้ว");
    if (Math.abs(amount - order.total_amount) > AMOUNT_TOLERANCE) {
      throw badRequest(`ยอดชำระต้องเท่ากับยอดออเดอร์ (${order.total_amount} บาท)`);
    }
  } else {
    assertObjectId(input.preorder_id as string, "preorder_id");
    const preorder = await preorderModel
      .findOne({ _id: input.preorder_id, deleted_at: null })
      .lean<any>();
    if (!preorder) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ");
    if (preorder.payment_status === "paid") throw conflict("พรีออเดอร์นี้ชำระเงินแล้ว");
  }

  // กันสร้าง payment ซ้ำ: 1 order/preorder มีใบที่ยัง active (pending) ได้ใบเดียว
  // ไม่งั้นจะเกิดหลาย doc, order.payment_id ถูกเขียนทับ, ใบเก่ากลายเป็น orphan
  const activeFilter: Record<string, any> = { deleted_at: null, status: "pending" };
  if (hasOrder) activeFilter.order_id = input.order_id;
  else activeFilter.preorder_id = input.preorder_id;
  const activePayment = await paymentModel.findOne(activeFilter).lean<any>();
  if (activePayment) {
    throw conflict(
      "มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว — แนบสลิปกับรายการเดิมหรือรอแอดมินตรวจ",
      { payment_id: String(activePayment._id) }
    );
  }

  let payment;
  try {
    payment = await paymentModel.create({
      user_id: input.user_id,
      order_id: input.order_id ?? null,
      preorder_id: input.preorder_id ?? null,
      amount,
      status: "pending",
      promptpay_ref: input.promptpay_ref ?? null,
      slip_image_url: input.slip_image_url ?? null,
    });
  } catch (err: any) {
    // ชน partial unique index (race กับอีกคำขอที่สร้าง pending พร้อมกัน)
    if (err?.code === 11000) throw conflict("มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว");
    throw err;
  }

  // ผูก payment_id กลับไปที่ order/preorder (สถานะยัง pending)
  if (payment.order_id) {
    await orderModel.updateOne({ _id: payment.order_id }, { $set: { payment_id: payment._id } });
  } else if (payment.preorder_id) {
    await preorderModel.updateOne(
      { _id: payment.preorder_id },
      { $set: { payment_id: payment._id } }
    );
  }

  return payment.toObject();
}

// ── READ ────────────────────────────────────────────────────
export async function listPayments(query: ListPaymentQuery) {
  await dbConnect();

  const filter: Record<string, any> = {};
  if (!query.includeDeleted) filter.deleted_at = null;
  for (const key of ["user_id", "order_id", "preorder_id"] as const) {
    const val = query[key];
    if (val) {
      assertObjectId(val, key);
      filter[key] = val;
    }
  }
  if (query.status) filter.status = query.status;
  if (query.date_from || query.date_to) {
    filter.created_at = {};
    if (query.date_from) filter.created_at.$gte = new Date(query.date_from);
    if (query.date_to) filter.created_at.$lte = new Date(query.date_to);
  }

  const [items, total] = await Promise.all([
    paymentModel
      .find(filter)
      .sort({ created_at: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("user_id", "user_fullname email")
      .populate("verified_by", "user_fullname email")
      .lean(),
    paymentModel.countDocuments(filter),
  ]);

  return { items, meta: buildMeta(total, query.pagination) };
}

export async function getPaymentById(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await paymentModel
    .findOne({ _id: id, deleted_at: null })
    .populate("user_id", "user_fullname email")
    .populate("verified_by", "user_fullname email")
    .lean();
  if (!doc) throw notFound("ไม่พบรายการชำระเงินที่ระบุ");
  return doc;
}

// ── ลูกค้าแนบสลิป / แก้สลิป (ก่อนแอดมินตรวจ) ─────────────────
export async function submitSlip(
  id: string,
  input: { slip_image_url?: string | null; promptpay_ref?: string | null }
) {
  await dbConnect();
  assertObjectId(id);

  if (!input.slip_image_url) throw badRequest("กรุณาแนบ slip_image_url");

  const payment = await paymentModel.findOne({ _id: id, deleted_at: null });
  if (!payment) throw notFound("ไม่พบรายการชำระเงินที่ระบุ");
  if (payment.status === "paid") throw conflict("รายการนี้ได้รับการยืนยันแล้ว");
  if (payment.status === "refunded") throw conflict("รายการนี้ถูกคืนเงินแล้ว");

  payment.slip_image_url = input.slip_image_url;
  if (input.promptpay_ref !== undefined) payment.promptpay_ref = input.promptpay_ref;
  payment.status = "pending"; // ส่งใหม่หลังเคยถูกปฏิเสธ → กลับมารอตรวจ
  await payment.save();

  // แจ้งเตือนสลิปเข้าใหม่ (DB + LINE) — best-effort ไม่ทำให้แนบสลิปล้มเหลวถ้าแจ้งเตือนพัง
  notificationService
    .notify({
      title: "มีสลิปโอนเงินรอตรวจสอบ",
      message: `ยอด ${payment.amount.toLocaleString("th-TH")} บาท`,
      module: "finance",
      type: "info",
      link: payment.order_id ? `/owner/orders/manageOrders?id=${payment.order_id}` : null,
    })
    .catch((err) => log.error("payment.notify_failed", { payment_id: String(payment._id), err }));

  return payment.toObject();
}

// ── แอดมินตรวจสลิป ─────────────────────────────────────────
export async function verifyPayment(
  id: string,
  input: { verified_by: string; approved: boolean }
) {
  await dbConnect();
  assertObjectId(id);
  if (!isObjectId(input.verified_by)) throw badRequest("verified_by ต้องเป็น ObjectId");
  await assertRefExists(userModel, input.verified_by, "ผู้ตรวจสอบ", "verified_by");

  const payment = await paymentModel.findOne({ _id: id, deleted_at: null });
  if (!payment) throw notFound("ไม่พบรายการชำระเงินที่ระบุ");
  if (payment.status === "paid") throw conflict("รายการนี้ยืนยันไปแล้ว");
  if (payment.status === "refunded") throw conflict("รายการนี้ถูกคืนเงินแล้ว");

  payment.status = input.approved ? "paid" : "failed";
  payment.verified_by = input.verified_by as any;
  payment.verified_at = new Date();
  await payment.save();

  await propagateStatus(payment, payment.status as PaymentStatus);
  return payment.toObject();
}

// ── คืนเงิน ─────────────────────────────────────────────────
export async function refundPayment(id: string, input: { verified_by: string }) {
  await dbConnect();
  assertObjectId(id);
  if (!isObjectId(input.verified_by)) throw badRequest("verified_by ต้องเป็น ObjectId");
  await assertRefExists(userModel, input.verified_by, "ผู้ดำเนินการ", "verified_by");

  const payment = await paymentModel.findOne({ _id: id, deleted_at: null });
  if (!payment) throw notFound("ไม่พบรายการชำระเงินที่ระบุ");
  if (payment.status !== "paid") throw conflict("คืนเงินได้เฉพาะรายการที่ชำระแล้ว (paid)");

  payment.status = "refunded";
  payment.verified_by = input.verified_by as any;
  payment.verified_at = new Date();
  await payment.save();

  await propagateStatus(payment, "refunded");
  return payment.toObject();
}

// ── DELETE (soft) ───────────────────────────────────────────
export async function deletePayment(id: string) {
  await dbConnect();
  assertObjectId(id);
  const payment = await paymentModel.findOne({ _id: id, deleted_at: null });
  if (!payment) throw notFound("ไม่พบรายการชำระเงินที่ระบุ หรือถูกลบไปแล้ว");
  if (payment.status === "paid") {
    throw conflict("ลบรายการที่ชำระแล้วไม่ได้ ให้ทำรายการคืนเงินแทน");
  }
  payment.deleted_at = new Date();
  await payment.save();
  return { deleted: true, _id: payment._id };
}

// re-export ไว้ให้ route ใช้ตรวจ enum ได้สะดวก
export { PAYMENT_STATUSES } from "./orderService";
