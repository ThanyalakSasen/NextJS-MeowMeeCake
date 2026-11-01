// ─────────────────────────────────────────────────────────────
// preorderItemCancelService — ยกเลิกสินค้าออกจากรอบที่ยังเปิดอยู่แบบไม่ผลิต (ผู้ใช้เลือก 2026-11-01)
//
// ต่างจาก "ปิดการขาย" (is_active=false) และ deleteBlockerActions.releasePreorders ที่คำสั่งซื้อเดิมยังผลิตต่อ:
//   ใบที่มีแต่สินค้านี้ → ยกเลิกทั้งใบ · ใบที่มีสินค้าอื่นด้วย → ตัดเฉพาะสินค้านี้แล้วคิดยอดใหม่
//   แล้วเอาสินค้าออกจากรอบ — ไม่เหลือยอดให้ roundDemand นับเข้าใบสั่งผลิตตอนปิดรอบ
//
// ไม่ตั้ง refunded เอง: ร้านโอนเงินนอกระบบ ใบที่ยกเลิกทั้งใบค้าง "ยกเลิก + ชำระแล้ว" (รอโอนคืน) ·
// ใบที่เหลือสินค้าอื่นเก็บยอดที่ refund_due_amount จนกว่าร้านจะกดยืนยัน (markRefundDone)
//
// best-effort ต่อใบ (แบบ preorderRoundLifecycleService) — ใบที่พลาดอยู่ใน failed และสินค้ายังอยู่ในรอบ กดซ้ำได้
// ─────────────────────────────────────────────────────────────
import dbConnect from "../lib/dbConnect";
import { conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { log } from "../lib/logger";
import { adminLinks } from "../lib/adminLinks";
import { round2 } from "../lib/money";
import { computeItemCancellation } from "../lib/preorderItemCancellation";
import paymentModel from "../models/paymentModel";
import preorderItemModel from "../models/preorderItemModel";
import preorderModel from "../models/preorderModel";
import preorderRoundItemModel from "../models/preorderRoundItemModel";
import preorderRoundModel from "../models/preorderRoundModel";
import promotionModel from "../models/promotionModel";
import userCouponModel from "../models/userCouponModel";
import { customerMessages, customerWeb, notifyCustomerLater } from "./customerNotifyService";
import { notificationService } from "./notificationService";
import * as preorderRoundService from "./preorderRoundService";
import { cancelPreorder } from "./preorderService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CancelRoundItemResult {
  round_item_id: string;
  /** false = ยังมีใบที่ยกเลิกไม่สำเร็จ สินค้าถูกปิดขายแต่ยังอยู่ในรอบ */
  removed: boolean;
  cancelled_orders: string[];
  updated_orders: string[];
  refunds: Array<{ preorder_no: string; amount: number }>;
  refund_total: number;
  failed: Array<{ preorder_no: string; error: string }>;
}

interface AffectedPreorder {
  preorder: any;
  lines: any[];
  target: any[];
}

const lineLabel = (l: any) => `${l.product_snapshot?.product_name_th ?? ""} × ${l.quantity}`;

/** ใบที่ยังมีสินค้านี้อยู่ พร้อมรายการทุกบรรทัดของใบนั้น */
async function loadAffected(roundItemId: unknown): Promise<AffectedPreorder[]> {
  const ids = await preorderItemModel.distinct("preorder_id", { round_item_id: roundItemId, deleted_at: null });
  if (ids.length === 0) return [];
  const [preorders, lines] = await Promise.all([
    preorderModel.find({ _id: { $in: ids }, deleted_at: null, order_status: { $ne: "cancelled" } }).lean<any[]>(),
    preorderItemModel.find({ preorder_id: { $in: ids }, deleted_at: null }).lean<any[]>(),
  ]);
  return preorders.map((preorder) => {
    const own = lines.filter((l) => String(l.preorder_id) === String(preorder._id));
    return { preorder, lines: own, target: own.filter((l) => String(l.round_item_id) === String(roundItemId)) };
  });
}

/** ใบที่แตะไม่ได้ — ตรวจก่อนเริ่มเพื่อไม่ให้หยุดกลางทาง: ของเตรียมเสร็จ/ส่งแล้ว · สลิปรอตรวจ · ชำระรวมหลายบิล (ยอดกลุ่มผูกกันอยู่) */
async function assertNoBlockers(affected: AffectedPreorder[]): Promise<void> {
  const done = affected
    .filter(({ preorder: p }) => ["ready", "completed"].includes(p.order_status) || (p.delivery_status ?? "pending") !== "pending")
    .map(({ preorder: p }) => p.preorder_no);
  if (done.length) throw conflict(`คำสั่งซื้อเตรียมสินค้าเสร็จหรือจัดส่งแล้ว ยกเลิกสินค้าไม่ได้: ${done.join(", ")}`);

  const waiting = await paymentModel
    .find({
      preorder_id: { $in: affected.map(({ preorder: p }) => p._id) },
      status: "pending",
      deleted_at: null,
      $or: [{ slip_image_url: { $nin: [null, ""] } }, { group_id: { $ne: null } }],
    })
    .distinct("preorder_id");
  if (waiting.length) {
    const blocked = new Set(waiting.map(String));
    const nos = affected.filter(({ preorder: p }) => blocked.has(String(p._id))).map(({ preorder: p }) => p.preorder_no);
    throw conflict(`ตรวจสลิปของคำสั่งซื้อเหล่านี้ก่อน แล้วค่อยยกเลิกสินค้า: ${nos.join(", ")}`);
  }
}

/** ส่วนลดค่าส่งในใบนี้ — ไม่ได้เก็บแยกไว้ หาจากชนิดของคูปอง/โปรที่ใช้ (discount_amount รวมส่วนลดค่าส่งแล้ว) */
async function shippingDiscountOf(p: any): Promise<number> {
  if (!p.user_coupon_id && !p.promotion_id) return 0;
  const source = p.user_coupon_id
    ? await userCouponModel.findById(p.user_coupon_id).select("discount_type").lean<any>()
    : await promotionModel.findById(p.promotion_id).select("discount_type").lean<any>();
  if (source?.discount_type !== "FreeShipping") return 0;
  return Math.min(Number(p.delivery_fee ?? 0), Math.max(0, Number(p.discount_amount ?? 0) - Number(p.points_discount ?? 0)));
}

/** ตัดสินค้าออกจากใบที่ยังเหลือสินค้าอื่น — คืนยอดที่ต้องโอนคืน */
async function cancelLinesFromPreorder(p: any, target: any[], reason: string): Promise<number> {
  const removed = round2(target.reduce((s, l) => s + Number(l.total_price), 0));
  const next = computeItemCancellation(p, removed, await shippingDiscountOf(p));
  const refund = p.payment_status === "paid" ? next.refund : 0;
  const items = target.map(lineLabel).join(", ");

  // subtotal เป็นเงื่อนไข — กันกดซ้ำพร้อมกันแล้วหักยอดสองรอบ
  const claimed = await preorderModel.findOneAndUpdate(
    { _id: p._id, deleted_at: null, order_status: p.order_status, subtotal: p.subtotal },
    {
      $set: {
        subtotal: next.subtotal,
        discount_amount: next.discount_amount,
        total_amount: next.total_amount,
        ...(refund > 0 ? { refund_due_note: p.refund_due_note ? `${p.refund_due_note}, ${items}` : items } : {}),
      },
      $inc: { refund_due_amount: refund },
    },
    { returnDocument: "after" }
  );
  if (!claimed) throw conflict("คำสั่งซื้อเปลี่ยนไปแล้ว กรุณาลองใหม่");

  const now = new Date();
  await preorderItemModel.updateMany(
    { _id: { $in: target.map((l) => l._id) }, deleted_at: null },
    { $set: { deleted_at: now, cancelled_at: now, cancelled_reason: reason } }
  );
  for (const l of target) await preorderRoundService.releaseQty(String(l.round_item_id), l.quantity);

  // ยังไม่จ่าย = QR ต้องออกยอดใหม่ · ใบที่จ่ายแล้วคง payment.amount ไว้ตามยอดที่รับจริง
  await paymentModel.updateMany(
    { preorder_id: p._id, status: "pending", deleted_at: null, slip_image_url: { $in: [null, ""] }, group_id: null },
    { $set: { amount: next.total_amount } }
  );

  const text = customerMessages.preorderItemCancelled(p.preorder_no, items, next.total_amount, refund, reason);
  notifyCustomerLater(p.user_id, text, customerWeb.fromLineText("preorder", p._id, p.preorder_no, text, "warning"));
  return refund;
}

export async function cancelRoundItem(
  itemId: string,
  opts: { cancelled_by: string; reason?: string }
): Promise<CancelRoundItemResult> {
  await dbConnect();
  assertObjectId(itemId, "id");
  const item = await preorderRoundItemModel
    .findOne({ _id: itemId, deleted_at: null })
    .populate("product_id", "product_name_th")
    .lean<any>();
  if (!item) throw notFound("ไม่พบรายการสินค้าในรอบที่ระบุ หรือถูกลบไปแล้ว");
  const round = await preorderRoundModel.findById(item.round_id).select("round_name round_status").lean<any>();
  if (!round || !["scheduled", "open"].includes(round.round_status)) {
    throw conflict("ยกเลิกสินค้าได้เฉพาะรอบที่ตั้งเวลาไว้หรือเปิดรับอยู่");
  }

  await assertNoBlockers(await loadAffected(item._id));
  await preorderRoundItemModel.updateOne({ _id: item._id }, { $set: { is_active: false } });

  const productName = item.product_id?.product_name_th ?? "";
  const reason = opts.reason?.trim() || `ร้านยกเลิกสินค้า ${productName} ออกจากรอบ "${round.round_name}"`;
  const result: CancelRoundItemResult = {
    round_item_id: itemId,
    removed: false,
    cancelled_orders: [],
    updated_orders: [],
    refunds: [],
    refund_total: 0,
    failed: [],
  };

  // โหลดใหม่หลังปิดขาย — รวมใบที่สั่งเข้ามาระหว่างตรวจเงื่อนไขด้านบน
  for (const { preorder: p, lines, target } of await loadAffected(item._id)) {
    try {
      let refund = 0;
      if (target.length === lines.length) {
        await cancelPreorder(String(p._id), { cancelled_by: opts.cancelled_by, cancelled_reason: reason, skipAutoRefund: true });
        refund = p.payment_status === "paid" ? Number(p.total_amount) : 0;
        result.cancelled_orders.push(p.preorder_no);
      } else {
        refund = await cancelLinesFromPreorder(p, target, reason);
        result.updated_orders.push(p.preorder_no);
      }
      if (refund > 0) result.refunds.push({ preorder_no: p.preorder_no, amount: refund });
    } catch (err) {
      result.failed.push({ preorder_no: p.preorder_no, error: err instanceof Error ? err.message : String(err) });
    }
  }
  result.refund_total = round2(result.refunds.reduce((s, r) => s + r.amount, 0));

  if (result.failed.length === 0) {
    // ไม่มีใบค้างแล้ว — ล้างยอดจองที่อาจคลาดเคลื่อน ไม่ให้ removeRoundItem ติดเงื่อนไข "มีการจองแล้ว"
    await preorderRoundItemModel.updateOne({ _id: item._id }, { $set: { current_qty: 0 } });
    await preorderRoundService.removeRoundItem(itemId);
    result.removed = true;
  } else {
    log.error("preorder_item_cancel.partial_failure", { round_item_id: itemId, failed: result.failed });
  }

  if (result.refunds.length || result.failed.length) {
    const money = (n: number) => `${n.toLocaleString("th-TH")} บาท`;
    await notificationService
      .notify({
        title: `ยกเลิกสินค้าในรอบ "${round.round_name}" — รอโอนคืน ${money(result.refund_total)}`,
        message: [
          `ยกเลิก ${productName} ออกจากรอบแล้ว`,
          ...result.refunds.map((r) => `โอนคืน ${r.preorder_no}: ${money(r.amount)}`),
          ...result.failed.map((f) => `⚠️ ยกเลิกไม่สำเร็จ ${f.preorder_no}: ${f.error}`),
        ].join("\n"),
        module: "order",
        type: "warning",
        link: adminLinks.preorderOrders,
      })
      .catch((err) => log.error("preorder_item_cancel.notify_failed", { err }));
  }
  return result;
}

/** ร้านโอนเงินคืนแล้ว — ย้ายยอดรอโอนเป็นโอนแล้ว (ใช้ยอดเดิมเป็นเงื่อนไข กันกดซ้ำ) */
export async function markRefundDone(preorderId: string) {
  await dbConnect();
  assertObjectId(preorderId);
  const p = await preorderModel.findOne({ _id: preorderId, deleted_at: null }).lean<any>();
  if (!p) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ");
  const due = Number(p.refund_due_amount ?? 0);
  if (due <= 0) throw conflict("ไม่มียอดรอโอนคืนในคำสั่งซื้อนี้");
  const updated = await preorderModel
    .findOneAndUpdate(
      { _id: p._id, refund_due_amount: due },
      { $set: { refund_due_amount: 0, refund_due_note: null }, $inc: { refund_done_amount: due } },
      { returnDocument: "after" }
    )
    .lean<any>();
  if (!updated) throw conflict("ยอดรอโอนคืนเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่");
  notifyCustomerLater(p.user_id, null, customerWeb.partialRefundDone(p._id, p.preorder_no, due));
  return updated;
}
