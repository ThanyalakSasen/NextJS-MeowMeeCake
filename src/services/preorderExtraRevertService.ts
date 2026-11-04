// ─────────────────────────────────────────────────────────────
// preorderExtraRevertService — กำหนดชำระส่วนต่าง 30 นาที (ผู้ใช้ขอ 2026-11-04)
//
// ร้านเปลี่ยนสินค้าในใบที่ชำระแล้วจนมียอดชำระเพิ่ม → บันทึกรายการ/ยอด "ก่อนเปลี่ยน" ไว้ที่ preorder.extra_revert
// + expires_at = ตอนนี้ + 30 นาที · ลูกค้าไม่แนบสลิปภายในเวลา → คืนรายการและยอดเป็นแบบเดิมอัตโนมัติ
//   - มีสลิปยอดเพิ่มรอตรวจ = ยังไม่คืน (รอร้านตรวจ) · สลิปถูกปฏิเสธหลังหมดเวลา = คืนรอบถัดไป
//   - ชำระครบ / ยอดเพิ่มหมดเพราะแก้ทีหลัง = ล้าง extra_revert (clearRevertIfSettled)
//   - แก้ซ้ำระหว่างรอ: เก็บ snapshot เดิม (สถานะที่จ่ายครบล่าสุด) · เริ่มนับ 30 นาทีใหม่
//   - คืนเฉพาะรอบที่ยังเปิด/ตั้งเวลาไว้ (ปิดรอบแล้ว = เข้าผลิตไปแล้ว ร้านตามเงินเอง)
// เรียกจาก cron order-expiry (ทุก 5 นาที) · scheduler รอบพรีออเดอร์ (ก่อนปิดรอบ) · lazy ตอนลูกค้าเปิดหน้าชำระเงิน
// ─────────────────────────────────────────────────────────────
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { round2, toBaht } from "../lib/money";
import { adminLinks } from "../lib/adminLinks";
import paymentModel from "../models/paymentModel";
import preorderItemModel from "../models/preorderItemModel";
import preorderModel from "../models/preorderModel";
import preorderRoundModel from "../models/preorderRoundModel";
import preorderRoundItemModel from "../models/preorderRoundItemModel";
import { customerWeb, notifyCustomerLater } from "./customerNotifyService";
import { notificationService } from "./notificationService";
import * as preorderRoundService from "./preorderRoundService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const EXTRA_PAYMENT_WINDOW_MS = 30 * 60 * 1000;

export interface ExtraRevertSnapshot {
  expires_at: Date;
  amounts: {
    subtotal: number;
    discount_amount: number;
    total_amount: number;
    refund_due_amount: number;
    refund_due_note: string | null;
    extra_due_amount: number;
  };
  items: Array<{ _id: unknown; round_item_id: unknown; quantity: number; total_price: number }>;
}

/** snapshot ก่อนเปลี่ยน (ใบ + รายการที่ยังอยู่) — มี snapshot เดิมอยู่แล้วใช้ของเดิม แค่เริ่มนับเวลาใหม่ */
export function buildRevertSnapshot(p: any, current: any[], now = new Date()): ExtraRevertSnapshot {
  const expires_at = new Date(now.getTime() + EXTRA_PAYMENT_WINDOW_MS);
  if (p.extra_revert?.items) return { ...p.extra_revert, expires_at };
  return {
    expires_at,
    amounts: {
      subtotal: Number(p.subtotal),
      discount_amount: Number(p.discount_amount ?? 0),
      total_amount: Number(p.total_amount),
      refund_due_amount: Number(p.refund_due_amount ?? 0),
      refund_due_note: p.refund_due_note ?? null,
      extra_due_amount: Number(p.extra_due_amount ?? 0),
    },
    items: current.map((l) => ({ _id: l._id, round_item_id: l.round_item_id, quantity: Number(l.quantity), total_price: Number(l.total_price) })),
  };
}

/** ยอดเพิ่มหมดแล้ว (จ่ายครบ / แก้ให้ถูกลง / ยกเลิกบางรายการ) = ไม่ต้องคืนแล้ว */
export async function clearRevertIfSettled(preorderId: unknown): Promise<void> {
  await preorderModel.updateOne(
    { _id: preorderId, extra_revert: { $ne: null }, extra_due_amount: { $lt: 0.005 } },
    { $set: { extra_revert: null } }
  );
}

const REVERT_REASON = "ไม่ชำระส่วนต่างภายใน 30 นาที — คืนรายการเดิม (ระบบอัตโนมัติ)";

/** คืนรายการเดิมของใบเดียว — คืน true ถ้าคืนจริง · ไม่ throw */
async function revertOne(id: unknown, now: Date): Promise<boolean> {
  // สลิปยอดเพิ่มรอตรวจ = รอร้านตรวจก่อน
  if (await paymentModel.exists({ preorder_id: id, is_extra: true, status: "pending", deleted_at: null, slip_image_url: { $nin: [null, ""] } })) {
    return false;
  }
  const peek = await preorderModel.findById(id).select("round_id").lean<any>();
  const round = peek ? await preorderRoundModel.findById(peek.round_id).select("round_status").lean<any>() : null;
  if (!round || !["scheduled", "open"].includes(round.round_status)) return false;

  // จองสิทธิ์คืนแบบ atomic — กันสองงานคืนซ้อนกัน
  const p = await preorderModel.findOneAndUpdate(
    { _id: id, deleted_at: null, order_status: { $ne: "cancelled" }, "extra_revert.expires_at": { $lte: now }, extra_due_amount: { $gt: 0 } },
    { $set: { extra_revert: null } },
    { returnDocument: "before" }
  ).lean<any>();
  if (!p?.extra_revert?.items) return false;
  const snap: ExtraRevertSnapshot = p.extra_revert;

  const active = await preorderItemModel.find({ preorder_id: p._id, deleted_at: null }).lean<any[]>();
  const keepIds = new Set(snap.items.map((it) => String(it._id)));

  // โควตา: จำนวนต่อ round_item ตาม snapshot − ที่ใช้อยู่ตอนนี้
  const qtyDelta = new Map<string, number>();
  const bump = (rid: unknown, n: number) => qtyDelta.set(String(rid), (qtyDelta.get(String(rid)) ?? 0) + n);
  for (const it of snap.items) bump(it.round_item_id, Number(it.quantity));
  for (const l of active) bump(l.round_item_id, -Number(l.quantity));

  // รายการที่เพิ่ม/เปลี่ยนเข้ามา = เอาออก · รายการเดิม = คืนจำนวน/ยอดเดิม (รวมที่ถูกเอาออกไป)
  const extraIds = active.filter((l) => !keepIds.has(String(l._id))).map((l) => l._id);
  if (extraIds.length) {
    await preorderItemModel.updateMany(
      { _id: { $in: extraIds } },
      { $set: { deleted_at: now, cancelled_at: now, cancelled_reason: REVERT_REASON } }
    );
  }
  for (const it of snap.items) {
    await preorderItemModel.updateOne(
      { _id: it._id },
      { $set: { quantity: it.quantity, total_price: it.total_price, deleted_at: null, cancelled_at: null, cancelled_reason: null } }
    );
  }
  for (const [rid, n] of qtyDelta) {
    if (n < 0) await preorderRoundService.releaseQty(rid, -n);
    else if (n > 0) {
      // คืนของที่ลูกค้าจ่ายไว้แล้ว — โควตาเต็มไปแล้วก็ต้องคืนให้ (ยอมเกินโควตา + log)
      await preorderRoundService.commitQty(rid, n).catch(async () => {
        await preorderRoundItemModel.updateOne({ _id: rid }, { $inc: { current_qty: n } });
        log.warn("preorder.extra_revert_over_quota", { preorder_id: String(p._id), round_item_id: rid, qty: n });
      });
    }
  }

  const a = snap.amounts;
  await preorderModel.updateOne(
    { _id: p._id },
    {
      $set: {
        subtotal: a.subtotal,
        discount_amount: a.discount_amount,
        total_amount: a.total_amount,
        refund_due_amount: a.refund_due_amount,
        refund_due_note: a.refund_due_note,
        extra_due_amount: a.extra_due_amount,
      },
    }
  );
  // ใบชำระยอดเพิ่มที่ค้าง (ไม่มีสลิป / สลิปถูกปฏิเสธ) ไม่ใช้แล้ว
  await paymentModel.updateMany(
    { preorder_id: p._id, is_extra: true, deleted_at: null, status: { $in: ["pending", "failed"] } },
    { $set: { deleted_at: now } }
  );

  const due = round2(Number(p.extra_due_amount ?? 0));
  const items = snap.items.map((it) => {
    const l = [...active].find((x) => String(x._id) === String(it._id));
    return `${l?.product_snapshot?.product_name_th ?? "สินค้า"} ×${it.quantity}`;
  });
  const message = [
    `⏰ ไม่ได้ชำระเงินเพิ่ม ${toBaht(due).toLocaleString("th-TH")} บาท ภายใน 30 นาที — ระบบคืนรายการเดิมให้แล้ว`,
    ...(items.length ? [`รายการ: ${items.join(", ")}`] : []),
    `ยอดสุทธิ ${toBaht(a.total_amount).toLocaleString("th-TH")} บาท${a.extra_due_amount > 0 ? "" : " (ชำระครบแล้ว)"}`,
  ].join("\n");
  notifyCustomerLater(p.user_id, null, customerWeb.extraReverted(p._id, p.preorder_no, message));
  void notificationService
    .notify({
      title: `คืนรายการเดิม ${p.preorder_no} — ลูกค้าไม่ชำระส่วนต่าง`,
      message: `ไม่ได้ชำระเพิ่ม ${toBaht(due).toLocaleString("th-TH")} บาท ภายใน 30 นาที ระบบคืนสินค้าและยอดเป็นแบบก่อนเปลี่ยน`,
      module: "order",
      type: "warning",
      link: adminLinks.preorder(String(p._id)),
    })
    .catch((err) => log.error("preorder.extra_revert_notify_failed", { preorder_id: String(p._id), err }));
  log.info("preorder.extra_reverted", { preorder_id: String(p._id), extra_due: due });
  return true;
}

/** คืนรายการเดิมของใบที่เลยกำหนดชำระส่วนต่าง — preorderId = ใบเดียว (lazy) · ไม่ใส่ = ทุกใบ (cron) */
export async function revertExpiredExtraEdits(opts: { preorderId?: string; now?: Date } = {}): Promise<{ reverted: number }> {
  await dbConnect();
  const now = opts.now ?? new Date();
  const filter: Record<string, unknown> = {
    deleted_at: null,
    order_status: { $ne: "cancelled" },
    "extra_revert.expires_at": { $lte: now },
    extra_due_amount: { $gt: 0 },
  };
  if (opts.preorderId) filter._id = opts.preorderId;
  const due = await preorderModel.find(filter).select("_id").limit(200).lean<any[]>();
  let reverted = 0;
  for (const d of due) {
    try {
      if (await revertOne(d._id, now)) reverted++;
    } catch (err) {
      log.error("preorder.extra_revert_failed", { preorder_id: String(d._id), err });
    }
  }
  return { reverted };
}
