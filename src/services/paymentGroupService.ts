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
  // ชำระรวมได้: ทุกบิลยังรอชำระ (ไม่ยกเลิก/ไม่จ่ายแล้ว) และยังไม่ได้ส่งสลิปรวมที่รอตรวจ
  const canPayTogether = !allPaid && !awaitingReview && bills.every((b) => b.can_pay && b.payment_status !== "paid");
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
 * มีใบรอตรวจ/ถูกปฏิเสธอยู่แล้ว = แนบกับใบเดิม (submitSlip) · ยังไม่มี = สร้างใหม่พร้อมสลิป (createPayment)
 * แจ้งร้านครั้งเดียว (ไม่ใช่ทีละบิล)
 */
export async function submitGroupSlip(groupId: string, userId: string, slipUrl: string) {
  const page = await getGroupPaymentPage(groupId, userId);
  if (!page.can_pay_together) {
    throw conflict(
      page.status === "awaiting_review"
        ? "ส่งสลิปรวมแล้ว กำลังรอร้านตรวจสอบ"
        : "บางบิลชำระแล้ว ถูกยกเลิก หรือหมดเวลาชำระ — กรุณาชำระแยกที่หน้ารายละเอียดของแต่ละบิล"
    );
  }

  const results = [];
  for (const b of page.bills) {
    const filter = b.kind === "order" ? { order_id: b.id } : { preorder_id: b.id };
    const reusable = await paymentModel
      .findOne({ ...filter, deleted_at: null, status: { $in: ["pending", "failed"] } })
      .sort({ created_at: -1 })
      .select("_id")
      .lean<{ _id: unknown } | null>();
    if (reusable) {
      await paymentModel.updateOne({ _id: reusable._id }, { $set: { group_id: groupId } });
      results.push(await paymentService.submitSlip(String(reusable._id), { slip_image_url: slipUrl }, { notify: false }));
    } else {
      results.push(
        await paymentService.createPayment({
          user_id: userId,
          order_id: b.kind === "order" ? b.id : null,
          preorder_id: b.kind === "preorder" ? b.id : null,
          amount: b.amount,
          slip_image_url: slipUrl,
          group_id: groupId,
        })
      );
    }
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
