/**
 * paymentGroupService — ชำระรวมหลายบิล (โอนครั้งเดียว + สลิปเดียว · ผู้ใช้เลือก 2026-10-27)
 *
 *   GET  /api/shop/payment-groups/[id]       → getGroupPaymentPage: ทุกบิล + ยอดรวม + QR ยอดรวม + กำหนดชำระเร็วสุด
 *   POST /api/shop/payment-groups/[id]/slip  → submitGroupSlip: สลิปเดียวผูกกับ Payment ของทุกบิล (group_id เดียวกัน)
 *
 * แต่ละบิลยังมี Payment ของตัวเอง (ยอดของบิลนั้น) — หลังร้านตรวจจากหน้าออเดอร์/พรีออเดอร์ได้ตามเดิม
 * ยืนยัน/ปฏิเสธใบหนึ่งในกลุ่ม = ทั้งกลุ่ม (paymentService.verifyPayment) · คืนเงินยังทำรายบิล
 * ชำระรวมได้เฉพาะตอนทุกบิลยังรอชำระ — มีบิลยกเลิก/หมดเวลา/ชำระแล้ว = ให้ชำระแยกที่หน้าบิล (ยอดรวมไม่ตรงกับสลิป)
 */
import dbConnect from "../lib/dbConnect";
import { conflict, notFound } from "../lib/httpError";
import { isObjectId } from "../lib/objectId";
import { log } from "../lib/logger";
import { trackBackground } from "../lib/backgroundTasks";
import { adminLinks } from "../lib/adminLinks";
import { toBaht } from "../lib/money";
import paymentGroupModel from "../models/paymentGroupModel";
import paymentModel from "../models/paymentModel";
import orderModel from "../models/orderModel";
import preorderModel from "../models/preorderModel";
import { notificationService } from "./notificationService";
import { buildPromptPayQr } from "./promptpayService";
import * as paymentService from "./paymentService";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Member = { kind: "order" | "preorder"; ref_id: unknown; doc_no: string };

async function loadGroup(groupId: string, userId: string): Promise<{ _id: unknown; members: Member[] }> {
  await dbConnect();
  if (!isObjectId(groupId)) throw notFound("ไม่พบรายการชำระรวม");
  const group = await paymentGroupModel.findOne({ _id: groupId, user_id: userId, deleted_at: null }).lean<any>();
  if (!group) throw notFound("ไม่พบรายการชำระรวม");
  return group;
}

/** หน้าชำระรวม — สถานะแต่ละบิล (จาก getPaymentPage ซึ่งยกเลิกบิลที่หมดเวลาให้ก่อน) + ยอดรวม/QR เมื่อชำระรวมได้ */
export async function getGroupPaymentPage(groupId: string, userId: string) {
  const group = await loadGroup(groupId, userId);
  const bills = [];
  for (const m of group.members) {
    const page = await paymentService.getPaymentPage(m.kind, String(m.ref_id), userId);
    bills.push({
      kind: m.kind,
      id: String(m.ref_id),
      doc_no: page.order_no || m.doc_no,
      amount: page.amount,
      order_status: page.order_status,
      payment_status: page.payment_status,
      can_pay: page.can_pay,
      blocked_reason: page.blocked_reason,
      payment_record_status: page.payment_record_status,
      slip_url: page.slip_url,
      payment_due_at: page.payment_due_at,
    });
  }

  const total = Math.round(bills.reduce((s, b) => s + b.amount, 0) * 100) / 100;
  const allPaid = bills.every((b) => b.payment_status === "paid");
  // สลิปเดียวกันรอตรวจครบทุกบิล = ส่งสลิปรวมแล้ว
  const awaitingReview = !allPaid && bills.every((b) => b.payment_status === "paid" || (b.payment_record_status === "pending" && !!b.slip_url));
  // ชำระรวมได้: ทุกบิลยังรอชำระ (ไม่ยกเลิก/ไม่จ่ายแล้ว) และไม่มีบิลไหนมีสลิปรอตรวจ (สลิปรวม หรือลูกค้าจ่ายแยกบิลนั้นไปแล้ว
  // — ออก QR ยอดรวม = จ่ายบิลนั้นซ้ำ และสลิปรวมจะทับสลิปเดิม)
  const hasPendingSlip = (b: { payment_record_status?: unknown; slip_url?: unknown }) => b.payment_record_status === "pending" && !!b.slip_url;
  const canPayTogether = !allPaid && !awaitingReview && bills.every((b) => b.can_pay && b.payment_status !== "paid" && !hasPendingSlip(b));
  const dueTimes = bills.map((b) => (b.payment_due_at ? new Date(b.payment_due_at).getTime() : null)).filter((t): t is number => t !== null);

  let qr: { qr_image: string; account_name: string } | null = null;
  let qrError: string | null = null;
  if (canPayTogether && total > 0) {
    try {
      qr = await buildPromptPayQr(total);
    } catch (err: any) {
      qrError = err?.message ?? "สร้าง QR ไม่สำเร็จ";
    }
  }

  return {
    _id: String(group._id),
    bills,
    total_amount: total,
    status: allPaid ? "paid" : awaitingReview ? "awaiting_review" : canPayTogether ? "awaiting_payment" : "split",
    can_pay_together: canPayTogether,
    qr_image: qr?.qr_image ?? null,
    account_name: qr?.account_name ?? "",
    qr_error: qrError,
    payment_due_at: dueTimes.length ? new Date(Math.min(...dueTimes)) : null,
    server_time: new Date(),
  };
}

/**
 * สลิปเดียวสำหรับทุกบิลในกลุ่ม — แต่ละบิลได้ Payment (ยอดของบิล) ที่ใช้สลิปนี้ + group_id
 * มีใบที่ยังไม่มีสลิป/ถูกปฏิเสธอยู่แล้ว = แนบกับใบเดิม (submitSlip) · ยังไม่มี = สร้างใหม่พร้อมสลิป (createPayment)
 * ทั้งหมดหรือไม่เลย: บิลไหนพัง → คืนใบที่ทำไปแล้วกลับสภาพเดิม (route ลบไฟล์สลิปได้โดยไม่มีใบไหนชี้ไฟล์ที่หายไป)
 * แจ้งร้านครั้งเดียว (ไม่ใช่ทีละบิล)
 */
export async function submitGroupSlip(groupId: string, userId: string, slipUrl: string) {
  const page = await getGroupPaymentPage(groupId, userId);
  if (!page.can_pay_together) {
    throw conflict(
      page.status === "awaiting_review"
        ? "ส่งสลิปรวมแล้ว กำลังรอร้านตรวจสอบ"
        : "บางบิลชำระแล้ว ถูกยกเลิก มีสลิปรอตรวจ หรือหมดเวลาชำระ — กรุณาชำระแยกที่หน้ารายละเอียดของแต่ละบิล"
    );
  }

  const results = [];
  const undo: Array<() => Promise<unknown>> = [];
  try {
    for (const b of page.bills) {
      const filter = b.kind === "order" ? { order_id: b.id } : { preorder_id: b.id };
      const reusable = await paymentModel
        .findOne({ ...filter, deleted_at: null, $or: [{ status: "failed" }, { status: "pending", slip_image_url: null }] })
        .sort({ created_at: -1 })
        .select("_id status slip_image_url promptpay_ref group_id")
        .lean<any>();
      if (reusable) {
        const prev = { status: reusable.status, slip_image_url: reusable.slip_image_url, promptpay_ref: reusable.promptpay_ref, group_id: reusable.group_id };
        undo.push(() => paymentModel.updateOne({ _id: reusable._id }, { $set: prev }));
        results.push(await paymentService.submitSlip(String(reusable._id), { slip_image_url: slipUrl }, { notify: false, groupId }));
      } else {
        const billModel: any = b.kind === "order" ? orderModel : preorderModel;
        const prevPaymentId = (await billModel.findOne({ _id: b.id }).select("payment_id").lean())?.payment_id ?? null;
        const created: any = await paymentService.createPayment({
          user_id: userId,
          order_id: b.kind === "order" ? b.id : null,
          preorder_id: b.kind === "preorder" ? b.id : null,
          amount: b.amount,
          slip_image_url: slipUrl,
          group_id: groupId,
        });
        undo.push(async () => {
          await paymentModel.deleteOne({ _id: created._id });
          await billModel.updateOne({ _id: b.id }, { $set: { payment_id: prevPaymentId } });
        });
        results.push(created);
      }
    }
  } catch (err) {
    for (const fn of undo.reverse()) {
      await fn().catch((e) => log.error("payment_group.slip_rollback_failed", { group_id: groupId, err: e }));
    }
    throw err;
  }

  void trackBackground(
    notificationService
      .notify({
        title: `มีสลิปชำระรวม ${page.bills.length} บิลรอตรวจสอบ: ${page.bills.map((b) => b.doc_no).join(", ")}`,
        message: `ยอดรวม ${toBaht(page.total_amount).toLocaleString("th-TH")} บาท — ยืนยัน/ปฏิเสธที่บิลใดบิลหนึ่ง มีผลกับทุกบิลในกลุ่ม`,
        module: "finance",
        type: "info",
        link: page.bills[0].kind === "order" ? adminLinks.order(page.bills[0].id) : adminLinks.preorder(page.bills[0].id),
      })
      .catch((err) => log.error("payment_group.notify_failed", { group_id: groupId, err }))
  );

  return { group_id: groupId, payments: results };
}

/** กลุ่มที่บิลนี้อยู่ (หน้าชำระเงินรายบิลแสดงลิงก์ "ชำระรวม") — ไม่อยู่ในกลุ่ม = null */
export async function groupIdOf(refId: unknown): Promise<string | null> {
  const g = await paymentGroupModel.findOne({ "members.ref_id": refId, deleted_at: null }).select("_id").lean<{ _id: unknown } | null>();
  return g ? String(g._id) : null;
}

/** ข้อมูลกลุ่มสำหรับหลังร้าน (แสดงคู่สลิป): เลขบิลทั้งหมด + ยอดรวมของสลิป */
export async function groupSummaries(groupIds: string[]): Promise<Map<string, { doc_nos: string[]; total_amount: number; bill_count: number }>> {
  const out = new Map<string, { doc_nos: string[]; total_amount: number; bill_count: number }>();
  if (groupIds.length === 0) return out;
  const groups = await paymentGroupModel.find({ _id: { $in: groupIds } }).lean<any[]>();
  const payments = await paymentModel
    .find({ group_id: { $in: groupIds }, deleted_at: null })
    .select("group_id amount order_id preorder_id")
    .lean<any[]>();
  for (const g of groups) {
    const gid = String(g._id);
    // ยอดรวม = ยอดของใบที่ผูกกลุ่มนี้ (1 ใบต่อบิล — ใบล่าสุด)
    const byBill = new Map<string, number>();
    for (const p of payments.filter((x) => String(x.group_id) === gid)) byBill.set(String(p.order_id ?? p.preorder_id), Number(p.amount ?? 0));
    out.set(gid, {
      doc_nos: (g.members as Member[]).map((m) => m.doc_no),
      total_amount: Math.round([...byBill.values()].reduce((s, n) => s + n, 0) * 100) / 100,
      bill_count: (g.members as Member[]).length,
    });
  }
  return out;
}

/**
 * รวมค่าส่ง (checkoutService): บิลนี้ไม่เก็บค่าส่งเพราะบิลอื่นเก็บแทน — บิลที่เก็บแทนถูกยกเลิก (หรือเลยกำหนดชำระ) โดยยังไม่ได้จ่าย
 * → คืนค่าส่งให้บิลนี้ (delivery_fee + total_amount) ก่อนออกยอด/QR ไม่งั้นร้านส่งของโดยไม่ได้ค่าส่ง
 * ทำเฉพาะบิลที่ยังไม่จ่ายและไม่มีสลิปรอตรวจ (จ่ายไปแล้ว = ยอดตามสลิป ร้านรับค่าส่งเอง — log ไว้)
 * $pull waiver ก่อน (atomic) — เปิดหน้าพร้อมกันหลายแท็บ ค่าส่งถูกบวกครั้งเดียว
 */
export async function restoreWaivedShipping(kind: "order" | "preorder", id: string, userId: string): Promise<void> {
  const group = await paymentGroupModel
    .findOne({ user_id: userId, deleted_at: null, "shipping_waivers.ref_id": id })
    .select("shipping_waivers")
    .lean<any>();
  const waiver = group?.shipping_waivers?.find((w: any) => String(w.ref_id) === String(id));
  if (!waiver) return;

  await paymentService.expireIfDue(waiver.payer_kind, String(waiver.payer_ref_id), userId);
  const payerModel: any = waiver.payer_kind === "order" ? orderModel : preorderModel;
  const payer = await payerModel.findOne({ _id: waiver.payer_ref_id }).select("order_status payment_status").lean();
  if (payer && (payer.order_status !== "cancelled" || payer.payment_status === "paid")) return;

  const billModel: any = kind === "order" ? orderModel : preorderModel;
  const bill = await billModel.findOne({ _id: id, deleted_at: null }).select("order_status payment_status").lean();
  if (!bill || bill.order_status === "cancelled") return;
  const billFilter = kind === "order" ? { order_id: id } : { preorder_id: id };
  const hasSlip = await paymentModel.exists({ ...billFilter, deleted_at: null, status: { $in: ["pending", "paid"] }, slip_image_url: { $ne: null } });
  if (bill.payment_status === "paid" || hasSlip) {
    log.warn("payment_group.waived_shipping_unrecoverable", { kind, id, payer_ref_id: String(waiver.payer_ref_id), fee: waiver.fee });
    return;
  }

  const pulled = await paymentGroupModel.updateOne(
    { _id: group._id, "shipping_waivers.ref_id": id },
    { $pull: { shipping_waivers: { ref_id: id } } }
  );
  if (pulled.modifiedCount === 0) return;
  const fee = Number(waiver.fee) || 0;
  if (fee <= 0) return;
  await billModel.updateOne({ _id: id }, { $inc: { delivery_fee: fee, total_amount: fee } });
  // ใบชำระที่ยังไม่มีสลิป (ยอดเดิม) ให้ยอดตรงกับบิล
  await paymentModel.updateMany({ ...billFilter, deleted_at: null, status: "pending", slip_image_url: null }, { $inc: { amount: fee } });
  log.info("payment_group.waived_shipping_restored", { kind, id, payer_ref_id: String(waiver.payer_ref_id), fee });
}
