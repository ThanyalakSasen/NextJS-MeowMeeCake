/**
 * preorderRoundLifecycleService — วงจรอัตโนมัติของรอบพรีออเดอร์ (docs/preorder-round-flow.md §6)
 *
 * การตัดสินใจ (ผู้ใช้ 2026-10-01):
 *   ประเด็น 3 — ใบสั่งผลิตนับเฉพาะพรีออเดอร์ที่ "ยืนยันการชำระเงินแล้ว" (payment_status = paid)
 *              + ยกเลิกอัตโนมัติเมื่อไม่จ่ายภายในกำหนด
 *              กำหนดชำระ = min(เวลาสั่ง + PREORDER_PAYMENT_DEADLINE_HOURS, เวลาปิดรอบ)
 *              แนบสลิปแล้วแต่แอดมินยังไม่ตรวจ = ไม่ยกเลิก (รอแอดมิน) และไม่นับเข้าใบผลิตจนกว่าจะยืนยัน
 *   ประเด็น 5 — เปิด/ปิดรอบอัตโนมัติตามเวลา (runRoundScheduler — cron)
 *   ประเด็น 8 — ปิดรอบแล้วเปิดกลับได้ ถ้ายังไม่มีใบสั่งผลิต (preorderRoundService.updateRoundStatus)
 *   + ปิดรอบ (มือหรืออัตโนมัติ) → ยกเลิกคนไม่จ่าย → สร้างใบสั่งผลิตอัตโนมัติ
 *     production_date = วันรับ − lead_time_days ที่ยาวที่สุดในรอบ
 *   + จ่ายหลังสร้างใบผลิตแล้ว → บวกจำนวนเข้าใบผลิตเดิม (ถ้ายัง planned) ไม่งั้นแจ้งร้าน
 *
 * ทุกอย่างเป็น best-effort ต่อรายการ — รายการไหนพังไม่หยุดรายการอื่น ผลรวมคืนให้ผู้เรียก + log
 */
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { bangkokDateString } from "../lib/datetime";
import preorderModel from "../models/preorderModel";
import preorderItemModel from "../models/preorderItemModel";
import preorderRoundModel from "../models/preorderRoundModel";
import preorderRoundItemModel from "../models/preorderRoundItemModel";
import paymentModel from "../models/paymentModel";
import productModel from "../models/productModel";
import productionOrderModel from "../models/productionOrderModel";
import productionItemModel from "../models/productionItemModel";
import recipeModel from "../models/recipeModel";
import { notificationService } from "./notificationService";

/* eslint-disable @typescript-eslint/no-explicit-any */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_PAYMENT_DEADLINE_HOURS = 24;

// ── กำหนดชำระ ────────────────────────────────────────────────
/** PREORDER_PAYMENT_DEADLINE_HOURS — จำนวนชั่วโมงหลังสั่งที่ต้องจ่าย (ค่าเริ่มต้น 24 · ค่าผิด = 24) */
export function paymentDeadlineHours(): number {
  const raw = process.env.PREORDER_PAYMENT_DEADLINE_HOURS?.trim();
  if (!raw) return DEFAULT_PAYMENT_DEADLINE_HOURS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PAYMENT_DEADLINE_HOURS;
}

/** กำหนดชำระ = min(เวลาสั่ง + N ชม., เวลาปิดรอบ) — ตอนปิดรอบทุกคนต้องจ่ายแล้ว ใบผลิตจึงครบตั้งแต่แรก */
export function computePaymentDueAt(orderedAt: Date, closeDate: Date): Date {
  const byHours = new Date(orderedAt).getTime() + paymentDeadlineHours() * HOUR_MS;
  return new Date(Math.min(byHours, new Date(closeDate).getTime()));
}

// ── ยกเลิกพรีออเดอร์ที่ไม่จ่ายภายในกำหนด ─────────────────────
export interface UnpaidCancelResult {
  cancelled: string[];
  /** เลยกำหนดแต่มีสลิปรอแอดมินตรวจ — ไม่ยกเลิก (ตัดสินใจ 2026-10-01) */
  waitingSlip: string[];
  failed: Array<{ preorder_no: string; error: string }>;
}

/**
 * @param opts.roundId  จำกัดเฉพาะรอบนี้
 * @param opts.allInRound  ยกเลิกทุกรายการที่ยังไม่จ่ายในรอบ ไม่สนกำหนด (ใช้ตอนปิดรอบ — ปิดก่อนเวลาก็ถือว่าหมดเวลาจ่าย)
 */
export async function cancelUnpaidPreorders(
  opts: { now?: Date; roundId?: unknown; allInRound?: boolean } = {}
): Promise<UnpaidCancelResult> {
  await dbConnect();
  const now = opts.now ?? new Date();
  const filter: Record<string, any> = {
    deleted_at: null,
    order_status: { $nin: ["cancelled", "completed"] },
    payment_status: { $in: ["pending", "failed"] },
  };
  if (opts.roundId) filter.round_id = opts.roundId;
  if (!opts.allInRound) filter.payment_due_at = { $ne: null, $lte: now };

  const due = await preorderModel.find(filter).select("_id preorder_no").lean<Array<{ _id: unknown; preorder_no: string }>>();
  const result: UnpaidCancelResult = { cancelled: [], waitingSlip: [], failed: [] };
  if (due.length === 0) return result;

  // มีสลิปรอตรวจ = payment สถานะ pending ที่แนบสลิปแล้ว
  const withSlip = await paymentModel
    .find({
      preorder_id: { $in: due.map((p) => p._id) },
      status: "pending",
      slip_image_url: { $nin: [null, ""] },
      deleted_at: null,
    })
    .distinct("preorder_id");
  const waiting = new Set(withSlip.map(String));

  const { cancelPreorder } = await import("./preorderService");
  for (const p of due) {
    if (waiting.has(String(p._id))) {
      result.waitingSlip.push(p.preorder_no);
      continue;
    }
    try {
      await cancelPreorder(String(p._id), {
        cancelled_reason: "ไม่ได้ชำระเงินภายในกำหนด — ระบบยกเลิกอัตโนมัติ",
      });
      result.cancelled.push(p.preorder_no);
    } catch (err) {
      result.failed.push({ preorder_no: p.preorder_no, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (result.cancelled.length || result.failed.length) {
    log.info("preorder_lifecycle.unpaid_cancelled", {
      cancelled: result.cancelled.length,
      waiting_slip: result.waitingSlip.length,
      failed: result.failed.length,
    });
  }
  return result;
}

// ── สร้างใบสั่งผลิตอัตโนมัติ ─────────────────────────────────
/** วันผลิต = วันรับ − lead_time_days ที่ยาวที่สุดของสินค้าในรอบ (ไม่ก่อนวันปิดรอบ) · ไม่มีค่า lead time = 1 วัน */
export async function productionDateForRound(round: { _id: unknown; close_date: Date; pickup_date: Date }): Promise<Date> {
  const productIds = await preorderRoundItemModel.find({ round_id: round._id, deleted_at: null }).distinct("product_id");
  const products = productIds.length
    ? await productModel.find({ _id: { $in: productIds } }).select("preorder_config").lean<any[]>()
    : [];
  const maxLead = Math.max(1, ...products.map((p) => Number(p.preorder_config?.lead_time_days) || 0));
  const date = new Date(new Date(round.pickup_date).getTime() - maxLead * DAY_MS);
  return new Date(Math.max(date.getTime(), new Date(round.close_date).getTime()));
}

export interface AutoProductionResult {
  created: boolean;
  production_no?: string;
  production_date?: string;
  /** สร้างไม่ได้ (ไม่มีพรีออเดอร์ที่จ่ายแล้ว / สินค้าไม่มีสูตร / มีใบอยู่แล้ว) */
  reason?: string;
}

export async function autoCreateProduction(roundId: unknown): Promise<AutoProductionResult> {
  const round = await preorderRoundModel.findOne({ _id: roundId, deleted_at: null }).lean<any>();
  if (!round) return { created: false, reason: "ไม่พบรอบ" };
  const productionDate = await productionDateForRound(round);
  try {
    const { createProductionFromRound } = await import("./productionOrderService");
    const order = (await createProductionFromRound({
      round_id: String(round._id),
      production_date: productionDate,
      production_note: `สร้างอัตโนมัติเมื่อปิดรอบ "${round.round_name}" — นับเฉพาะพรีออเดอร์ที่ชำระเงินแล้ว`,
    })) as { production_no?: string };
    return { created: true, production_no: order.production_no, production_date: bangkokDateString(productionDate) };
  } catch (err) {
    return { created: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ── ขั้นตอนหลังปิดรอบ ───────────────────────────────────────
export interface CloseRoundResult {
  unpaid: UnpaidCancelResult;
  production: AutoProductionResult;
}

/**
 * เรียกหลังรอบเปลี่ยนเป็น closed แล้ว (มือ: preorderRoundService.updateRoundStatus · อัตโนมัติ: runRoundScheduler)
 * 1) ยกเลิกทุกรายการที่ยังไม่จ่ายในรอบ (ยกเว้นมีสลิปรอตรวจ) 2) สร้างใบสั่งผลิตจากที่จ่ายแล้ว 3) สรุปให้ร้าน
 */
export async function onRoundClosed(roundId: unknown): Promise<CloseRoundResult> {
  await dbConnect();
  const unpaid = await cancelUnpaidPreorders({ roundId, allInRound: true });
  const production = await autoCreateProduction(roundId);

  const round = await preorderRoundModel.findById(roundId).select("round_name").lean<any>();
  const lines = [
    production.created
      ? `สร้างใบสั่งผลิต ${production.production_no} (วันผลิต ${production.production_date}) แล้ว`
      : `ยังไม่ได้สร้างใบสั่งผลิต: ${production.reason}`,
    `ยกเลิกพรีออเดอร์ที่ไม่ชำระเงิน ${unpaid.cancelled.length} รายการ`,
  ];
  if (unpaid.waitingSlip.length) {
    lines.push(`⚠️ มีสลิปรอตรวจ ${unpaid.waitingSlip.length} รายการ (${unpaid.waitingSlip.join(", ")}) — ยืนยันแล้วระบบจะบวกเข้าใบผลิตให้`);
  }
  if (unpaid.failed.length) lines.push(`⚠️ ยกเลิกไม่สำเร็จ ${unpaid.failed.length} รายการ — ตรวจสอบด้วยตนเอง`);
  await notificationService
    .notify({
      title: `ปิดรอบพรีออเดอร์ "${round?.round_name ?? ""}"`,
      message: lines.join("\n"),
      module: "production",
      type: production.created ? "info" : "warning",
      link: null,
    })
    .catch((err) => log.error("preorder_lifecycle.close_notify_failed", { err }));

  return { unpaid, production };
}

// ── จ่ายหลังสร้างใบผลิตแล้ว → บวกเข้าใบผลิต ────────────────────
export type LatePaymentOutcome = "not-closed" | "created-production" | "added" | "production-started" | "no-recipe" | "skipped";

/**
 * เรียกเมื่อพรีออเดอร์เพิ่งเปลี่ยนเป็น paid (preorderService.setPaymentStatus)
 *   รอบยังไม่ปิด → ไม่ทำอะไร (ตอนปิดรอบจะนับเอง)
 *   รอบปิดแล้วแต่ยังไม่มีใบผลิต (เช่น ตอนปิดไม่มีใครจ่ายเลย) → สร้างใบผลิตให้
 *   ใบผลิตยัง planned → บวก planned_qty ของรายการสินค้าเดิม (หรือเพิ่มรายการใหม่ถ้ายังไม่มีสินค้านี้)
 *   ใบผลิตเริ่มผลิตแล้ว (in_progress / done) → ไม่แตะ แจ้งร้านให้จัดการเอง
 * กันบวกซ้ำด้วย preorders.added_to_production_at
 */
export async function onPreorderPaid(preorderId: string): Promise<LatePaymentOutcome> {
  await dbConnect();
  const pre = await preorderModel.findOne({ _id: preorderId, deleted_at: null }).lean<any>();
  if (!pre || pre.order_status === "cancelled" || pre.payment_status !== "paid" || pre.added_to_production_at) {
    return "skipped";
  }
  const round = await preorderRoundModel.findOne({ _id: pre.round_id }).lean<any>();
  if (!round || round.round_status !== "closed") return "not-closed";

  const production = await productionOrderModel
    .findOne({ round_id: round._id, deleted_at: null, production_status: { $ne: "cancelled" } })
    .lean<any>();

  if (!production) {
    const res = await autoCreateProduction(round._id); // นับรายการนี้ไปด้วยแล้ว (จ่ายแล้ว)
    if (res.created) {
      await preorderModel.updateOne({ _id: pre._id }, { $set: { added_to_production_at: new Date() } });
      return "created-production";
    }
    await notifyOwner(`พรีออเดอร์ ${pre.preorder_no} ชำระเงินหลังปิดรอบ แต่สร้างใบสั่งผลิตไม่ได้: ${res.reason}`);
    return "skipped";
  }

  if (production.production_status !== "planned") {
    await notifyOwner(
      `พรีออเดอร์ ${pre.preorder_no} ชำระเงินหลังใบสั่งผลิต ${production.production_no} เริ่มผลิตแล้ว — ` +
        "ระบบไม่ได้เพิ่มจำนวนให้ กรุณาเพิ่มรายการผลิตเอง"
    );
    return "production-started";
  }

  // จอง flag ก่อน (atomic) กันบวกซ้ำถ้าถูกเรียกพร้อมกัน
  const claimed = await preorderModel.findOneAndUpdate(
    { _id: pre._id, added_to_production_at: null },
    { $set: { added_to_production_at: new Date() } }
  );
  if (!claimed) return "skipped";

  const items = await preorderItemModel.find({ preorder_id: pre._id, deleted_at: null }).lean<any[]>();
  const { addItems } = await import("./productionItemService");
  for (const it of items) {
    const res = await productionItemModel.updateOne(
      {
        production_order_id: production._id,
        product_id: it.product_id,
        deleted_at: null,
        item_status: "pending",
        stock_updated_at: null,
      },
      { $inc: { planned_qty: it.quantity } }
    );
    if (res.modifiedCount === 1) continue;

    // ยังไม่มีรายการของสินค้านี้ในใบผลิต (หรือรายการเดิมเริ่มแล้ว) → เพิ่มรายการใหม่ด้วยสูตรล่าสุด
    const recipe = await recipeModel
      .findOne({ product_id: it.product_id, deleted_at: null })
      .sort({ created_at: -1, _id: -1 })
      .lean<any>();
    if (!recipe) {
      await notifyOwner(`พรีออเดอร์ ${pre.preorder_no} ชำระเงินหลังสร้างใบผลิต แต่สินค้าไม่มีสูตร — เพิ่มเข้าใบผลิตไม่ได้`);
      return "no-recipe";
    }
    await addItems(String(production._id), [
      {
        product_id: String(it.product_id),
        recipe_id: String(recipe._id),
        planned_qty: it.quantity,
        round_item_id: it.round_item_id ? String(it.round_item_id) : null,
      },
    ]);
  }

  await notificationService
    .notify({
      title: `เพิ่มยอดสินค้าเข้าใบสั่งผลิต ${production.production_no}`,
      message: `พรีออเดอร์ ${pre.preorder_no} ชำระเงินหลังปิดรอบ — บวกจำนวนเข้าใบผลิตแล้ว`,
      module: "production",
      type: "info",
      link: null,
      line: false,
    })
    .catch((err) => log.error("preorder_lifecycle.late_notify_failed", { err }));
  return "added";
}

// ── ยกเลิกพรีออเดอร์ที่ถูกนับเข้าใบผลิตแล้ว → ลดใบผลิต (docs/BACKLOG4.md Y1) ─────────
export type CancelledSyncOutcome = "not-counted" | "no-production" | "reduced" | "production-started" | "skipped";

/**
 * เรียกหลังพรีออเดอร์ถูกยกเลิก (preorderService.updatePreorderStatus) — กลับด้านของ onPreorderPaid
 * เดิม: ยกเลิก/คืนเงินหลังสร้างใบผลิต ใบผลิตไม่ลด → ผลิตเกินจำนวนที่ต้องส่งจริง
 *   ไม่เคยถูกนับ (ตอนยกเลิกยังไม่จ่าย) / รอบยังไม่ปิด → ไม่ทำอะไร
 *   ใบผลิต planned → ลด planned_qty ของรายการสินค้า (เฉพาะรายการ pending ที่ยังไม่ตัดสต็อก) · เหลือ 0 → รายการเป็น cancelled
 *   ใบผลิตเริ่มผลิตแล้ว → ไม่แตะ แจ้งร้าน
 * กันลดซ้ำด้วย preorders.removed_from_production_at (จองแบบ atomic)
 * @param wasPaid สถานะการจ่ายก่อนยกเลิก — ยกเลิกรายการที่จ่ายแล้วจะคืนเงินอัตโนมัติ payment_status ใน DB จึงเปลี่ยนไปแล้ว
 */
export async function onPreorderCancelled(preorderId: string, wasPaid: boolean): Promise<CancelledSyncOutcome> {
  await dbConnect();
  if (!wasPaid) return "not-counted"; // ใบผลิตนับเฉพาะ paid (ประเด็น 3)
  const pre = await preorderModel.findOne({ _id: preorderId }).lean<any>();
  if (!pre || pre.removed_from_production_at) return "skipped";
  const round = await preorderRoundModel.findOne({ _id: pre.round_id }).select("round_status").lean<any>();
  if (!round || round.round_status !== "closed") return "not-counted";

  const production = await productionOrderModel
    .findOne({ round_id: pre.round_id, deleted_at: null, production_status: { $ne: "cancelled" } })
    .lean<any>();
  if (!production) return "no-production";
  if (production.production_status !== "planned") {
    await notifyOwner(
      `พรีออเดอร์ ${pre.preorder_no} ถูกยกเลิกหลังใบสั่งผลิต ${production.production_no} เริ่มผลิตแล้ว — ` +
        "ระบบไม่ได้ลดจำนวนให้ ปรับรายการผลิตเองถ้าจำเป็น",
      "พรีออเดอร์ถูกยกเลิกหลังเริ่มผลิต"
    );
    return "production-started";
  }

  const claimed = await preorderModel.findOneAndUpdate(
    { _id: pre._id, removed_from_production_at: null },
    { $set: { removed_from_production_at: new Date() } }
  );
  if (!claimed) return "skipped";

  const items = await preorderItemModel.find({ preorder_id: pre._id, deleted_at: null }).lean<any[]>();
  for (const it of items) {
    const pi = await productionItemModel
      .findOne({
        production_order_id: production._id,
        product_id: it.product_id,
        deleted_at: null,
        item_status: "pending",
        stock_updated_at: null,
      })
      .lean<any>();
    if (!pi) continue;
    const next = Math.max(0, pi.planned_qty - it.quantity);
    await productionItemModel.updateOne(
      { _id: pi._id },
      { $set: next === 0 ? { planned_qty: 0, item_status: "cancelled" } : { planned_qty: next } }
    );
  }

  await notificationService
    .notify({
      title: `หักยอดสินค้าในใบสั่งผลิต ${production.production_no}`,
      message: `พรีออเดอร์ ${pre.preorder_no} ถูกยกเลิก — หักจำนวนออกจากใบผลิตแล้ว`,
      module: "production",
      type: "info",
      link: null,
      line: false,
    })
    .catch((err) => log.error("preorder_lifecycle.cancel_notify_failed", { err }));
  return "reduced";
}

async function notifyOwner(message: string, title = "พรีออเดอร์ชำระเงินหลังปิดรอบ"): Promise<void> {
  await notificationService
    .notify({ title, message, module: "production", type: "warning", link: null })
    .catch((err) => log.error("preorder_lifecycle.owner_notify_failed", { err }));
}

// ── ตัวตั้งเวลา: เปิด/ปิดรอบ + ยกเลิกคนไม่จ่าย ────────────────
export interface SchedulerResult {
  opened: string[];
  closed: Array<{ round_name: string } & CloseRoundResult>;
  unpaid: UnpaidCancelResult;
}

/**
 * รันเป็นระยะจาก cron (แนะนำทุก 15 นาที — /api/cron/preorder-rounds หรือ npm run cron:preorder-rounds)
 * 1) scheduled + ถึง open_date → open  2) open + เลย close_date → closed + onRoundClosed
 * 3) ยกเลิกพรีออเดอร์ที่เลยกำหนดชำระ (รอบที่ยังเปิดอยู่)
 * รันซ้ำได้ — เปลี่ยนสถานะแบบมีเงื่อนไข (สถานะเดิม) ไม่ทำซ้ำ
 */
export async function runRoundScheduler(opts: { now?: Date } = {}): Promise<SchedulerResult> {
  await dbConnect();
  const now = opts.now ?? new Date();
  const result: SchedulerResult = { opened: [], closed: [], unpaid: { cancelled: [], waitingSlip: [], failed: [] } };

  const toOpen = await preorderRoundModel
    .find({ deleted_at: null, round_status: "scheduled", open_date: { $lte: now }, close_date: { $gt: now } })
    .select("_id round_name")
    .lean<any[]>();
  for (const r of toOpen) {
    const res = await preorderRoundModel.updateOne({ _id: r._id, round_status: "scheduled" }, { $set: { round_status: "open" } });
    if (res.modifiedCount === 1) result.opened.push(r.round_name);
  }

  // scheduled ที่เลย close_date ไปแล้วทั้งช่วง (ไม่เคยเปิด) ก็ปิดด้วย — ไม่มีใครสั่งได้อยู่แล้ว
  const toClose = await preorderRoundModel
    .find({ deleted_at: null, round_status: { $in: ["open", "scheduled"] }, close_date: { $lte: now } })
    .select("_id round_name round_status")
    .lean<any[]>();
  for (const r of toClose) {
    const res = await preorderRoundModel.updateOne(
      { _id: r._id, round_status: r.round_status },
      { $set: { round_status: "closed" } }
    );
    if (res.modifiedCount !== 1) continue; // มีคนปิดไปแล้ว
    result.closed.push({ round_name: r.round_name, ...(await onRoundClosed(r._id)) });
  }

  result.unpaid = await cancelUnpaidPreorders({ now });
  if (result.opened.length || result.closed.length) {
    log.info("preorder_lifecycle.scheduler", { opened: result.opened.length, closed: result.closed.length });
  }
  return result;
}
