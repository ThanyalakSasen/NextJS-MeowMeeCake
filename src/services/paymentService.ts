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
import { trackBackground } from "../lib/backgroundTasks";
import * as orderService from "./orderService";
import * as preorderService from "./preorderService";
import { toSatang, toBaht, toBahtFields } from "../lib/money";
import { UPLOAD_DIRS } from "../lib/upload";
import { isPrivateFileUrl } from "../lib/privateFiles";
import type { PaymentStatus } from "./orderService";
import { adminLinks } from "../lib/adminLinks";
import { buildPromptPayQr } from "./promptpayService";
import { warnSlipOnCancelledPreorder } from "./preorderRoundLifecycleService";

/* eslint-disable @typescript-eslint/no-explicit-any */

// เทียบยอดชำระกับ order/preorder.total_amount (บาท) — เผื่อส่วนต่างปัดเศษได้ไม่เกิน 1 สตางค์ (0.01 บาท)
// (+1e-9 กัน float เช่น 100.1 - 100.09) · เดิม = 1 จากสมัยเก็บสตางค์ — หลังเปลี่ยนเป็นบาท (BACKLOG4 R7) กลายเป็น
// "ขาดได้ 1 บาท" โดยไม่ตั้งใจ (docs/BACKLOG5.md G1 — เจอตอนไล่คอมเมนต์ยุคสตางค์)
const AMOUNT_TOLERANCE = 0.01 + 1e-9;

/**
 * สลิปต้องเป็นไฟล์ที่อัปโหลดผ่านระบบเรา (public/uploads/slips — docs/uploads.md) — เดิมรับ string อะไรก็ได้
 * ทำให้ DB มี path ที่ไม่มีไฟล์จริง (/uploads/slip-*.jpg ที่ไม่เคยถูกอัปโหลดมาที่ backend) และเปิดช่องให้ใส่
 * url ภายนอก (เช่น tracking pixel) ที่แอดมินจะเปิดดูตอนตรวจสลิป
 */
function assertSlipUrl(url: string | null | undefined): void {
  if (url == null || url === "") return;
  // สลิปเป็นไฟล์ส่วนตัว (/api/files/slips/… — BACKLOG4 Y3) ไม่ใช่ public/uploads
  if (!isPrivateFileUrl(url, UPLOAD_DIRS.slips)) {
    throw badRequest(
      "slip_image_url ต้องเป็นไฟล์ที่อัปโหลดผ่านระบบ — ใช้ POST /api/shop/payments/[id]/slip (multipart) แทน"
    );
  }
}

export interface CreatePaymentInput {
  user_id: string;
  order_id?: string | null;
  preorder_id?: string | null;
  amount: number;
  promptpay_ref?: string | null;
  slip_image_url?: string | null;
  /** ชำระรวมหลายบิล (paymentGroupService.submitGroupSlip) */
  group_id?: string | null;
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
// BACKLOG 2b.2: preorder ต้องผ่าน preorderService.setPaymentStatus() เหมือน order ผ่าน
// orderService.setPaymentStatus() — ไม่งั้น auto-advance order_status pending→confirmed
// ตอนจ่ายเงินจะไม่ทำงาน (เดิมเขียน payment_status ตรงผ่าน preorderModel.updateOne เฉย ๆ)
async function propagateStatus(payment: any, status: PaymentStatus) {
  if (payment.order_id) {
    await orderService.setPaymentStatus(String(payment.order_id), status, String(payment._id));
  } else if (payment.preorder_id) {
    await preorderService.setPaymentStatus(String(payment.preorder_id), status, String(payment._id));
  }
}

/**
 * ตรวจซ้ำหลังบันทึกสลิป — ระหว่างที่เราเช็คสถานะกับบันทึกสลิป cron อาจยกเลิกเอกสารเพราะหมดเวลาชำระไปแล้ว
 * (cron เองก็ตรวจสลิปซ้ำหลังยกเลิก — ฝั่งใดฝั่งหนึ่งจะเห็นอีกฝั่งเสมอ) · ออเดอร์ → เปิดกลับ · พรีออเดอร์ → แจ้งร้าน
 * best-effort: สลิปบันทึกแล้ว ไม่ให้คำขอของลูกค้าพังเพราะขั้นนี้
 */
async function reconcileAfterSlip(payment: { _id: unknown; order_id?: unknown; preorder_id?: unknown }): Promise<void> {
  try {
    if (payment.order_id) await orderService.reconcileExpiredWithSlip(String(payment.order_id));
    else if (payment.preorder_id) await warnSlipOnCancelledPreorder(String(payment.preorder_id));
  } catch (err) {
    log.error("payment.reconcile_after_slip_failed", { payment_id: String(payment._id), err });
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

  // input.amount เป็นบาทจาก client — ปัด 2 ตำแหน่งทันที แล้วใช้ค่านี้เทียบกับ order/preorder.total_amount (บาท)
  const amount = toSatang(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest("amount ต้องเป็นตัวเลขมากกว่า 0");
  }

  // ออเดอร์เว็บที่ถูกยกเลิกเพราะหมดเวลาชำระ + แนบสลิปมา → เปิดกลับก่อนบันทึก (docs/customer-backend-merge.md §8.8)
  let reopenOrder = false;
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
    if (orderService.canReopenWithLateSlip(order)) {
      if (!input.slip_image_url) {
        throw badRequest("หมดเวลาชำระเงินแล้ว — แนบสลิปเพื่อขอเปิดคำสั่งซื้อกลับ");
      }
      reopenOrder = true;
    } else if (order.order_status === "cancelled") {
      throw conflict("ออเดอร์นี้ถูกยกเลิกแล้ว");
    }
    if (Math.abs(amount - order.total_amount) > AMOUNT_TOLERANCE) {
      throw badRequest(`ยอดชำระต้องเท่ากับยอดออเดอร์ (${toBaht(order.total_amount)} บาท)`);
    }
  } else {
    assertObjectId(input.preorder_id as string, "preorder_id");
    const preorder = await preorderModel
      .findOne({ _id: input.preorder_id, deleted_at: null })
      .lean<any>();
    if (!preorder) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ");
    if (String(preorder.user_id) !== String(input.user_id)) {
      throw badRequest("พรีออเดอร์นี้ไม่ได้เป็นของผู้ใช้ที่ระบุ");
    }
    if (preorder.payment_status === "paid") throw conflict("พรีออเดอร์นี้ชำระเงินแล้ว");
    if (preorder.order_status === "cancelled") throw conflict("พรีออเดอร์นี้ถูกยกเลิกแล้ว");
    if (Math.abs(amount - preorder.total_amount) > AMOUNT_TOLERANCE) {
      throw badRequest(`ยอดชำระต้องเท่ากับยอดพรีออเดอร์ (${toBaht(preorder.total_amount)} บาท)`);
    }
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

  // ตรวจสลิปก่อน (ต้องเป็นไฟล์ที่ระบบอัปโหลดเอง — #54) แล้วค่อยเปิดออเดอร์ที่หมดเวลากลับ (ตัดสต็อกใหม่ — ของไม่พอ = 409 ไม่สร้าง payment)
  assertSlipUrl(input.slip_image_url);
  if (reopenOrder) await orderService.reopenExpiredOrder(String(input.order_id));

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
      group_id: input.group_id ?? null,
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
  if (payment.slip_image_url) await reconcileAfterSlip(payment);

  return presentPayment(payment.toObject());
}

// amount — เงินเก็บเป็นบาท ทศนิยม 2 ตำแหน่ง (docs/money-units.md) · presenter แค่ปัดก่อนคืน
function presentPayment<T extends Record<string, unknown>>(payment: T): T {
  return toBahtFields(payment, ["amount"] as const);
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

  return { items: await withGroupInfo(items.map(presentPayment)), meta: buildMeta(total, query.pagination) };
}

/**
 * ใบที่ชำระรวมหลายบิล — แนบ group: { doc_nos, total_amount, bill_count } ให้หลังร้านเห็นว่าสลิปนี้ครอบคลุมบิลไหนบ้าง
 * (ยอดในสลิป = ยอดรวมของกลุ่ม ไม่ใช่ยอดบิลนี้)
 */
async function withGroupInfo<T extends Record<string, any>>(items: T[]): Promise<Array<T & { group: unknown }>> {
  const ids = [...new Set(items.map((p) => (p.group_id ? String(p.group_id) : null)).filter((x): x is string => !!x))];
  if (ids.length === 0) return items.map((p) => ({ ...p, group: null }));
  const { groupSummaries } = await import("./paymentGroupService");
  const groups = await groupSummaries(ids);
  return items.map((p) => ({ ...p, group: p.group_id ? groups.get(String(p.group_id)) ?? null : null }));
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
  return presentPayment(doc);
}

/** เลขเอกสารของ payment: order_no (ORD-/POS-…) หรือ preorder_no (PRE-…) · หาไม่เจอ = ObjectId เดิม (ยังพอสืบได้) */
export async function paymentDocNo(payment: { order_id?: unknown; preorder_id?: unknown }): Promise<string> {
  if (payment.order_id) {
    const o = await orderModel.findById(payment.order_id).select("order_no").lean<{ order_no?: string } | null>();
    return o?.order_no ?? String(payment.order_id);
  }
  if (payment.preorder_id) {
    const p = await preorderModel.findById(payment.preorder_id).select("preorder_no").lean<{ preorder_no?: string } | null>();
    return p?.preorder_no ?? String(payment.preorder_id);
  }
  return "-";
}

// ── ลูกค้าแนบสลิป / แก้สลิป (ก่อนแอดมินตรวจ) ─────────────────
export async function submitSlip(
  id: string,
  input: { slip_image_url?: string | null; promptpay_ref?: string | null },
  /**
   * notify: false = ไม่แจ้งร้านทีละใบ (ชำระรวม — paymentGroupService แจ้งครั้งเดียวทั้งกลุ่ม)
   * groupId = สลิปรวมของกลุ่มนี้ · ไม่ส่ง = สลิปของบิลนี้บิลเดียว → ล้าง group_id เดิม (ไม่ให้ยืนยันแล้วลามไปบิลอื่น)
   */
  opts: { notify?: boolean; groupId?: string | null } = {}
) {
  await dbConnect();
  assertObjectId(id);

  if (!input.slip_image_url) throw badRequest("กรุณาแนบ slip_image_url");
  assertSlipUrl(input.slip_image_url);

  const payment = await paymentModel.findOne({ _id: id, deleted_at: null });
  if (!payment) throw notFound("ไม่พบรายการชำระเงินที่ระบุ");
  if (payment.status === "paid") throw conflict("รายการนี้ได้รับการยืนยันแล้ว");
  if (payment.status === "refunded") throw conflict("รายการนี้ถูกคืนเงินแล้ว");

  // ออเดอร์เว็บถูกยกเลิกเพราะหมดเวลาชำระ → แนบสลิปย้อนหลังเปิดกลับ (ตัดสต็อกใหม่ · ของไม่พอ = 409)
  if (payment.order_id) {
    const order = await orderModel
      .findOne({ _id: payment.order_id, deleted_at: null })
      .select("order_status payment_status cancelled_reason points_redeemed user_coupon_id")
      .lean<any>();
    if (order && orderService.canReopenWithLateSlip(order)) {
      await orderService.reopenExpiredOrder(String(payment.order_id));
    } else if (order?.order_status === "cancelled") {
      throw conflict("ออเดอร์นี้ถูกยกเลิกแล้ว");
    }
  } else if (payment.preorder_id) {
    // เดิมไม่ตรวจเลย — แนบสลิปกับพรีออเดอร์ที่ถูกยกเลิกได้ แล้วแอดมินอนุมัติจนได้ "ยกเลิก + ชำระแล้ว"
    const preorder = await preorderModel
      .findOne({ _id: payment.preorder_id, deleted_at: null })
      .select("order_status")
      .lean<{ order_status?: string } | null>();
    if (preorder?.order_status === "cancelled") throw conflict("พรีออเดอร์นี้ถูกยกเลิกแล้ว");
  }

  payment.slip_image_url = input.slip_image_url;
  payment.group_id = opts.groupId ?? null;
  if (input.promptpay_ref !== undefined) payment.promptpay_ref = input.promptpay_ref;
  payment.status = "pending"; // ส่งใหม่หลังเคยถูกปฏิเสธ → กลับมารอตรวจ
  await payment.save();
  await reconcileAfterSlip(payment);
  if (opts.notify === false) return presentPayment(payment.toObject());

  // แจ้งเตือนสลิปเข้าใหม่ (DB + LINE) — best-effort ไม่ทำให้แนบสลิปล้มเหลวถ้าแจ้งเตือนพัง
  // หัวข้อแสดงเลขเอกสารที่คนอ่านรู้เรื่อง (ORD-/POS-/PRE-…) ไม่ใช่ ObjectId — หาเลขหลังตอบลูกค้าแล้ว (ไม่หน่วง response)
  // ลงทะเบียนทั้ง chain เป็นงานเบื้องหลัง — notify() เกิดหลังหาเลขเอกสาร ถ้าไม่ครอบ flushBackground() จะไม่รอขั้นนี้
  void trackBackground(
    paymentDocNo(payment)
      .then((docNo) =>
        notificationService.notify({
          title: "มีคำสั่งซื้อรอตรวจสอบสลิปโอนเงิน รหัสคำสั่งซื้อ " + docNo,
          message: `ยอด ${toBaht(payment.amount).toLocaleString("th-TH")} บาท`,
          module: "finance",
          type: "info",
          link: payment.order_id
            ? adminLinks.order(payment.order_id)
            : payment.preorder_id
              ? adminLinks.preorder(payment.preorder_id)
              : null,
        })
      )
      .catch((err) => log.error("payment.notify_failed", { payment_id: String(payment._id), err }))
  );

  return presentPayment(payment.toObject());
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

  // เปลี่ยนสถานะแบบมีเงื่อนไข (atomic) — แอดมิน 2 คนกดพร้อมกัน / กดซ้ำ ได้ผลสำเร็จแค่ครั้งเดียว
  // (เดิมอ่าน → เช็ค → save ทำให้ทั้งสองคำขอผ่าน แล้วอัปเดตออเดอร์/แจ้งลูกค้าซ้ำ)
  const status = input.approved ? "paid" : "failed";
  const payment = await paymentModel.findOneAndUpdate(
    { _id: id, deleted_at: null, status: { $in: ["pending", "failed"] } },
    { $set: { status, verified_by: input.verified_by, verified_at: new Date() } },
    { returnDocument: "after" }
  );
  if (!payment) {
    const current = await paymentModel.findOne({ _id: id, deleted_at: null }).select("status").lean<{ status: string } | null>();
    if (!current) throw notFound("ไม่พบรายการชำระเงินที่ระบุ");
    if (current.status === "refunded") throw conflict("รายการนี้ถูกคืนเงินแล้ว");
    throw conflict("รายการนี้ยืนยันไปแล้ว");
  }

  await propagateStatus(payment, status);

  // ชำระรวม (สลิปเดียวหลายบิล) — ยืนยัน/ปฏิเสธใบหนึ่ง = ทุกใบในกลุ่มที่ยังรอตรวจ "สลิปเดียวกัน"
  // เฉพาะ pending + slip เดียวกัน: ใบที่ถูกปฏิเสธไปแล้ว/ส่งสลิปแยกเอง ไม่ใช่เงินก้อนนี้ · บิลที่ถูกยกเลิกไม่ผูกสถานะตาม
  if (payment.group_id && payment.slip_image_url) {
    const siblings = await paymentModel
      .find({ group_id: payment.group_id, _id: { $ne: payment._id }, deleted_at: null, status: "pending", slip_image_url: payment.slip_image_url })
      .select("_id order_id preorder_id")
      .lean<{ _id: unknown; order_id?: unknown; preorder_id?: unknown }[]>();
    for (const s of siblings) {
      const bill = s.order_id
        ? await orderModel.findOne({ _id: s.order_id }).select("order_status").lean<{ order_status?: string } | null>()
        : await preorderModel.findOne({ _id: s.preorder_id }).select("order_status").lean<{ order_status?: string } | null>();
      if (!bill || bill.order_status === "cancelled") {
        log.warn("payment.group_sibling_skipped", { payment_id: String(s._id), group_id: String(payment.group_id) });
        continue;
      }
      const sib = await paymentModel.findOneAndUpdate(
        { _id: s._id, deleted_at: null, status: "pending", slip_image_url: payment.slip_image_url },
        { $set: { status, verified_by: input.verified_by, verified_at: new Date() } },
        { returnDocument: "after" }
      );
      if (sib) await propagateStatus(sib, status);
    }
  }
  return presentPayment(payment.toObject());
}

// ── คืนเงิน ─────────────────────────────────────────────────
export async function refundPayment(id: string, input: { verified_by: string }) {
  await dbConnect();
  assertObjectId(id);
  if (!isObjectId(input.verified_by)) throw badRequest("verified_by ต้องเป็น ObjectId");
  await assertRefExists(userModel, input.verified_by, "ผู้ดำเนินการ", "verified_by");

  // atomic เหมือน verifyPayment — คืนเงินซ้ำพร้อมกันได้ผลครั้งเดียว
  const payment = await paymentModel.findOneAndUpdate(
    { _id: id, deleted_at: null, status: "paid" },
    { $set: { status: "refunded", verified_by: input.verified_by, verified_at: new Date() } },
    { returnDocument: "after" }
  );
  if (!payment) {
    if (!(await paymentModel.exists({ _id: id, deleted_at: null }))) throw notFound("ไม่พบรายการชำระเงินที่ระบุ");
    throw conflict("คืนเงินได้เฉพาะรายการที่ชำระแล้ว (paid)");
  }

  await propagateStatus(payment, "refunded");
  return presentPayment(payment.toObject());
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

// ── หน้าชำระเงินของลูกค้า: QR พร้อมเพย์ + สถานะ (docs/customer-backend-merge.md §8.8) ─────────
export type PaymentPageKind = "order" | "preorder";

/** ยังชำระเงิน/ส่งสลิปได้ไหม — null = ได้ */
function paymentBlockedReason(doc: any, kind: PaymentPageKind): string | null {
  if (doc.order_status === "cancelled") {
    if (kind === "order" && orderService.canReopenWithLateSlip(doc)) {
      return "หมดเวลาชำระเงินแล้ว คำสั่งซื้อนี้ถูกยกเลิกอัตโนมัติ — ถ้าโอนเงินไปแล้ว แนบสลิปเพื่อขอเปิดคำสั่งซื้อกลับ";
    }
    return "คำสั่งซื้อนี้ถูกยกเลิกแล้ว";
  }
  if (doc.order_status === "completed") return "คำสั่งซื้อนี้เสร็จสิ้นแล้ว";
  if (doc.payment_status === "paid") return "คำสั่งซื้อนี้ชำระเงินเรียบร้อยแล้ว";
  if (doc.payment_status === "refunded") return "คำสั่งซื้อนี้คืนเงินแล้ว";
  return null;
}

/**
 * GET /api/shop/{orders|preorders}/[id]/payment — ข้อมูลหน้าชำระเงินของเจ้าของคำสั่งซื้อ
 *   ออเดอร์/พรีออเดอร์: ยกเลิกก่อนถ้าเลยกำหนดชำระแล้ว (lazy — expireUnpaidOrders / cancelUnpaidPreorders · พรีออเดอร์มี cron อีกชั้น)
 *   QR ออกเฉพาะตอนยังต้องชำระ · หมดเวลาแล้ว (ออเดอร์) → late_upload = แนบสลิปย้อนหลังเพื่อเปิดกลับได้ (ไม่ออก QR ใหม่)
 *   ร้านยังไม่ตั้งเลขพร้อมเพย์ → qr_image null + qr_error (ไม่ทำให้หน้าพัง)
 */
/** ยกเลิกบิลของลูกค้าที่เลยกำหนดชำระ (lazy — ไม่ต้องรอ cron) · มีสลิปรอตรวจ = ไม่ยกเลิก */
export async function expireIfDue(kind: PaymentPageKind, id: string, userId: string): Promise<void> {
  if (kind === "order") await orderService.expireUnpaidOrders({ userId, orderId: id });
  else {
    // พรีออเดอร์เลยกำหนด (30 นาที) → ยกเลิกทันทีตอนเปิดหน้า ไม่ต้องรอ cron รอบถัดไป
    const own = await preorderModel.exists({ _id: id, user_id: userId, deleted_at: null });
    if (own) {
      const { cancelUnpaidPreorders } = await import("./preorderRoundLifecycleService");
      await cancelUnpaidPreorders({ preorderId: id });
    }
  }
}

export async function getPaymentPage(kind: PaymentPageKind, id: string, userId: string) {
  await dbConnect();
  if (!isObjectId(id)) throw notFound("ไม่พบคำสั่งซื้อ");
  await expireIfDue(kind, id, userId);
  // สั่งซื้อรวม: บิลที่รวมค่าส่งไว้ถูกยกเลิกก่อนชำระ → คืนค่าส่งให้บิลนี้ก่อนออกยอด/QR
  await (await import("./paymentGroupService")).restoreWaivedShipping(kind, id, userId);

  const model: any = kind === "order" ? orderModel : preorderModel;
  const numberField = kind === "order" ? "order_no" : "preorder_no";
  const doc = await model
    .findOne({ _id: id, user_id: userId, deleted_at: null })
    .select(`${numberField} order_status payment_status total_amount payment_id payment_due_at cancelled_reason points_redeemed user_coupon_id`)
    .lean();
  if (!doc) throw notFound("ไม่พบคำสั่งซื้อ");

  const payment = await paymentModel
    .findOne({ [kind === "order" ? "order_id" : "preorder_id"]: doc._id, deleted_at: null })
    .sort({ created_at: -1 })
    .select("status slip_image_url")
    .lean<{ _id: unknown; status: string; slip_image_url?: string | null } | null>();

  const amount = toBaht(Number(doc.total_amount ?? 0));
  const blocked = paymentBlockedReason(doc, kind);
  const lateUpload = kind === "order" && orderService.canReopenWithLateSlip(doc);
  let qr: { qr_image: string; account_name: string } | null = null;
  let qrError: string | null = null;
  if (!blocked && amount > 0) {
    try {
      qr = await buildPromptPayQr(amount);
    } catch (err: any) {
      qrError = err?.message ?? "สร้าง QR ไม่สำเร็จ";
    }
  }

  return {
    kind,
    id: String(doc._id),
    order_no: String(doc[numberField] ?? ""),
    amount,
    order_status: doc.order_status,
    payment_status: doc.payment_status,
    can_pay: !blocked,
    blocked_reason: blocked,
    late_upload: lateUpload,
    qr_image: qr?.qr_image ?? null,
    account_name: qr?.account_name ?? "",
    qr_error: qrError,
    payment_id: payment ? String(payment._id) : null,
    payment_record_status: payment?.status ?? null,
    slip_url: payment?.slip_image_url ?? null,
    // หมดเขตชำระ + เวลา server — หน้าเว็บนับถอยหลังได้แม่นแม้นาฬิกาเครื่องลูกค้าเพี้ยน
    payment_due_at: doc.payment_due_at ?? null,
    server_time: new Date(),
    // สั่งพร้อมบิลอื่น (ตะกร้ารวม) — หน้าเว็บแสดงลิงก์ไปชำระรวม /customer/account/payment-group/{group_id}
    group_id: await (await import("./paymentGroupService")).groupIdOf(doc._id),
  };
}

// re-export ไว้ให้ route ใช้ตรวจ enum ได้สะดวก
export { PAYMENT_STATUSES } from "./orderService";
