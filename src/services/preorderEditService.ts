// ─────────────────────────────────────────────────────────────
// preorderEditService — ร้านแก้พรีออเดอร์หลังร้าน (สรุปรอบ → รายชื่อลูกค้า · ผู้ใช้ขอ 2026-11-03)
//
// updatePreorderAddress: แก้ชื่อ/เบอร์ผู้รับ + ที่อยู่จัดส่ง (เฉพาะแบบจัดส่ง ยังไม่ส่งของ) — ค่าส่งคงเดิม
// editPreorderItems: ร้านโทรคุยกับลูกค้าแล้วเปลี่ยนสินค้าในใบ (ลด/เพิ่มจำนวน · เอาออก · เพิ่มสินค้าอื่นในรอบเดียวกัน)
//   - เฉพาะรอบที่ตั้งเวลาไว้/เปิดรับอยู่ (ยังไม่ออกใบสั่งผลิต — roundDemand นับตอนปิดรอบ)
//   - ชำระแล้ว: ถูกลง = ส่วนต่าง (หักส่วนลดตามสัดส่วน) เข้า refund_due_amount (ขั้นตอน "รอโอนคืน" เดิม — markRefundDone)
//     แพงขึ้น = ร้านต้องยืนยัน (allow_extra_payment) → ส่วนต่างเข้า extra_due_amount + payment ยอดเพิ่มให้ลูกค้าโอน
//     (preorderExtraPaymentService) · ยังไม่ชำระ: เปลี่ยนได้ทุกยอด QR ออกยอดใหม่
//   - ส่วนลดเป็นยอดคงที่ ไม่ตรวจขั้นต่ำของโปรซ้ำ (เหมือน preorderItemCancellation) · ค่าส่งคงเดิม
//   - รายการที่คงไว้ใช้ราคาเดิมตอนสั่ง · รายการใหม่ใช้ราคาปัจจุบันของรอบ + ตัวเลือก
//   - ไม่ตรวจเพดานต่อคนต่อรอบ (ร้านเป็นคนตัดสินใจ) แต่ตรวจขั้นต่ำต่อรายการ + โควตาของรอบเสมอ
// ─────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound, unprocessable } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { Saga } from "../lib/compensation";
import { round2 } from "../lib/money";
import { computeItemCancellation } from "../lib/preorderItemCancellation";
import paymentModel from "../models/paymentModel";
import preorderItemModel from "../models/preorderItemModel";
import preorderModel from "../models/preorderModel";
import preorderRoundModel from "../models/preorderRoundModel";
import preorderRoundItemModel from "../models/preorderRoundItemModel";
import { customerMessages, customerWeb, notifyCustomerLater } from "./customerNotifyService";
import { shippingDiscountOf } from "./preorderItemCancelService";
import { splitPaidDelta, syncExtraPayment } from "./preorderExtraPaymentService";
import { buildRevertSnapshot, EXTRA_PAYMENT_WINDOW_MS } from "./preorderExtraRevertService";
import * as preorderRoundService from "./preorderRoundService";
import * as recipeService from "./recipeService";
import { assertCustomizationIds, getCustomizations, resolveCustomization, type CustomizationInput } from "./productCustomizationService";
import { getPreorderById } from "./preorderService";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ADDRESS_FIELDS = ["recipient_name", "recipient_phone", "house_no", "sub_district", "district", "province", "zip_code"] as const;

export type PreorderAddressInput = Record<(typeof ADDRESS_FIELDS)[number], string>;

export interface EditPreorderItemsInput {
  /** รายการเดิมที่คงไว้ + จำนวนใหม่ · ไม่อยู่ในนี้ = เอาออก */
  keep: Array<{ item_id: string; quantity: number }>;
  /** สินค้าที่เพิ่ม (ในรอบเดียวกัน) */
  add: Array<CustomizationInput & { round_item_id: string; quantity: number; special_request?: string | null }>;
  reason?: string | null;
  /** ชำระแล้วแต่ยอดใหม่เกิน — ร้านยืนยันแล้วว่าให้ลูกค้าชำระเพิ่ม (ไม่ส่ง = ปฏิเสธ 422 EXTRA_PAYMENT_REQUIRED) */
  allow_extra_payment?: boolean;
}

export interface EditPreorderItemsResult {
  preorder: any;
  /** ยอดที่เพิ่มเข้า "รอโอนคืน" รอบนี้ (ชำระแล้วและยอดลดลง) */
  refund: number;
  /** ยอดที่เพิ่มเข้า "รอชำระเพิ่ม" รอบนี้ (ชำระแล้วและยอดเกิน) */
  extra: number;
  /** ยอดรอชำระเพิ่มทั้งหมดหลังแก้ */
  extra_due: number;
}

const lineLabel = (name: string, qty: number) => `${name} × ${qty}`;

/** ใบที่ยังแก้ได้: ไม่ยกเลิก · ยังไม่เตรียมเสร็จ/ส่ง */
function assertEditable(p: any) {
  if (!p) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ");
  if (p.order_status === "cancelled") throw conflict("คำสั่งซื้อนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้");
  if (["ready", "completed"].includes(p.order_status) || (p.delivery_status ?? "pending") !== "pending") {
    throw conflict("คำสั่งซื้อนี้เตรียมสินค้าเสร็จหรือจัดส่งแล้ว แก้ไขไม่ได้");
  }
}

// ── ผู้รับ + ที่อยู่ ─────────────────────────────────────────────
export async function updatePreorderAddress(id: string, input: PreorderAddressInput) {
  await dbConnect();
  assertObjectId(id);
  const p = await preorderModel.findOne({ _id: id, deleted_at: null }).lean<any>();
  assertEditable(p);
  if (p.order_type !== "delivery") throw conflict("แก้ที่อยู่ได้เฉพาะคำสั่งซื้อแบบจัดส่ง");

  const address = Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, String(input[f] ?? "").trim()]));
  for (const f of ADDRESS_FIELDS) if (!address[f]) throw badRequest(`delivery_address.${f} จำเป็นต้องระบุ`);

  await preorderModel.updateOne({ _id: p._id }, { $set: { delivery_address: address } });
  const text = customerMessages.preorderAddressChanged(
    p.preorder_no,
    [address.recipient_name, address.recipient_phone, address.house_no, address.sub_district, address.district, address.province, address.zip_code].join(" ")
  );
  notifyCustomerLater(p.user_id, text, customerWeb.fromLineText("preorder", p._id, p.preorder_no, text, "info"));
  return getPreorderById(id);
}

// ── รายการสินค้า ────────────────────────────────────────────────
/** สลิปรอตรวจ / ชำระรวมหลายบิล = ยอดผูกกับ payment อยู่ แก้รายการไม่ได้ */
async function assertNoPaymentBlocker(p: any) {
  const waiting = await paymentModel.exists({
    preorder_id: p._id,
    status: "pending",
    deleted_at: null,
    $or: [{ slip_image_url: { $nin: [null, ""] } }, { group_id: { $ne: null } }],
  });
  if (waiting) throw conflict("ตรวจสลิปของคำสั่งซื้อนี้ก่อน แล้วค่อยแก้ไขรายการสินค้า");
}

/** คำนวณผลการเปลี่ยนสินค้า (ยังไม่เขียนอะไร) — ใช้ทั้งหน้า "ตรวจสอบยอด" (previewPreorderEdit) และตอนบันทึกจริง */
async function planEdit(id: string, input: EditPreorderItemsInput) {
  await dbConnect();
  assertObjectId(id);
  const p = await preorderModel.findOne({ _id: id, deleted_at: null }).lean<any>();
  assertEditable(p);
  const round = await preorderRoundModel.findById(p.round_id).select("round_status pickup_date").lean<any>();
  if (!round || !["scheduled", "open"].includes(round.round_status)) {
    throw conflict("แก้ไขรายการสินค้าได้เฉพาะรอบที่ตั้งเวลาไว้หรือเปิดรับอยู่ (ยังไม่ออกใบสั่งผลิต)");
  }
  await assertNoPaymentBlocker(p);

  const current = await preorderItemModel.find({ preorder_id: p._id, deleted_at: null }).lean<any[]>();
  const currentById = new Map(current.map((l) => [String(l._id), l]));

  // ── รายการที่คงไว้ ──
  const keep = new Map<string, number>();
  for (const k of input.keep ?? []) {
    const line = currentById.get(String(k.item_id));
    if (!line) throw badRequest("ไม่พบรายการสินค้าเดิมที่ระบุในคำสั่งซื้อนี้");
    const qty = Number(k.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw badRequest("จำนวนของแต่ละรายการต้องเป็นจำนวนเต็มตั้งแต่ 1");
    if (keep.has(String(line._id))) throw badRequest("ระบุรายการเดิมซ้ำ");
    keep.set(String(line._id), qty);
  }

  // ── สินค้าที่เพิ่ม — ราคาปัจจุบันของรอบ + ตัวเลือก (กติกาเดียวกับตอนสั่ง) ──
  const add = input.add ?? [];
  add.forEach((a) => {
    assertObjectId(a.round_item_id, "round_item_id");
    assertCustomizationIds(a);
    if (!Number.isInteger(Number(a.quantity)) || Number(a.quantity) < 1) {
      throw badRequest("จำนวนของแต่ละรายการต้องเป็นจำนวนเต็มตั้งแต่ 1");
    }
  });
  const resolved = add.length
    ? await preorderRoundService.getOrderableRoundItems(add.map((a) => a.round_item_id), String(p.round_id))
    : [];
  const customizations = await getCustomizations(resolved.map(({ product }) => String(product._id)));
  const costByProduct = await recipeService.getUnitCostByProduct(resolved.map(({ product }) => String(product._id)));
  // ขั้นต่ำต่อรายการ (กติกาตอนลูกค้าสั่งเอง) — ร้านข้ามได้ เพราะตกลงกับลูกค้าแล้ว · preview แจ้งเตือนใน below_min
  const belowMin: Array<{ name: string; min_qty: number; quantity: number }> = [];
  const added = resolved.map(({ item, product, unit_price }, i) => {
    const qty = Number(add[i].quantity);
    const minQty = Math.max(item.min_order_qty ?? 1, product.preorder_config?.min_order_qty ?? 1);
    if (qty < minQty) belowMin.push({ name: product.product_name_th, min_qty: minQty, quantity: qty });
    const custom = resolveCustomization(customizations.get(String(product._id)) ?? { groups: [], options: [] }, add[i], product.product_name_th);
    const unit = round2(unit_price + custom.extra_price);
    return {
      preorder_id: p._id,
      round_item_id: item._id,
      product_id: product._id,
      product_snapshot: { product_name_th: product.product_name_th, product_name_eng: product.product_name_eng, variant_name: custom.variant_name },
      variant_id: custom.variant_id,
      selected_variants: custom.selected_variants,
      selected_options: custom.selected_options,
      pickup_date: round.pickup_date,
      special_request: add[i].special_request?.trim() || null,
      quantity: qty,
      unit_price: unit,
      total_price: round2(unit * qty),
      cost_per_unit: costByProduct.get(String(product._id)) ?? null,
    };
  });

  if (keep.size === 0 && added.length === 0) throw badRequest("คำสั่งซื้อต้องเหลือสินค้าอย่างน้อย 1 รายการ — ถ้าไม่เอาแล้วให้ยกเลิกคำสั่งซื้อแทน");

  // ── ยอดใหม่ ──
  const keptTotal = (l: any) => round2(Number(l.unit_price) * (keep.get(String(l._id)) ?? 0));
  const newSubtotal = round2(
    current.reduce((s, l) => s + keptTotal(l), 0) + added.reduce((s, l) => s + l.total_price, 0)
  );
  const oldSubtotal = Number(p.subtotal);
  const changed =
    added.length > 0 || current.some((l) => (keep.get(String(l._id)) ?? 0) !== Number(l.quantity));
  if (!changed) throw badRequest("ไม่มีรายการที่เปลี่ยนแปลง");

  const paid = p.payment_status === "paid";
  let amounts = { subtotal: newSubtotal, discount_amount: Number(p.discount_amount), total_amount: Number(p.total_amount), refund: 0 };
  if (newSubtotal < oldSubtotal) {
    amounts = computeItemCancellation(p, round2(oldSubtotal - newSubtotal), await shippingDiscountOf(p));
  } else if (newSubtotal > oldSubtotal) {
    amounts.total_amount = round2(Math.max(0, newSubtotal - Number(p.discount_amount) + Number(p.delivery_fee ?? 0)));
  }
  // ชำระแล้ว: ยอดลด → หักรอชำระเพิ่มก่อน เหลือเป็นรอโอนคืน · ยอดเพิ่ม → หักรอโอนคืนก่อน เหลือเป็นรอชำระเพิ่ม
  const { refundInc, extraInc } = paid
    ? splitPaidDelta(p, round2(amounts.total_amount - Number(p.total_amount)))
    : { refundInc: 0, extraInc: 0 };
  const refund = Math.max(0, refundInc);
  const extra = Math.max(0, extraInc);
  const refundDueAfter = round2(Number(p.refund_due_amount ?? 0) + refundInc);

  // ── โควตาของรอบต่อ round_item (เพิ่ม = จองก่อน · ลด = คืนหลังสำเร็จ) ──
  const delta = new Map<string, number>();
  const bump = (rid: unknown, n: number) => delta.set(String(rid), (delta.get(String(rid)) ?? 0) + n);
  for (const l of current) bump(l.round_item_id, (keep.get(String(l._id)) ?? 0) - Number(l.quantity));
  for (const l of added) bump(l.round_item_id, l.quantity);

  return { p, current, keep, keptTotal, added, belowMin, amounts, paid, refundInc, extraInc, refund, extra, refundDueAfter, delta, newSubtotal, oldSubtotal };
}

const linesText = (lines: Array<{ name: string; quantity: number }>) => lines.map((l) => lineLabel(l.name, l.quantity)).join(", ");

export interface PreorderEditPreview {
  before: { subtotal: number; discount_amount: number; delivery_fee: number; total_amount: number };
  after: { subtotal: number; discount_amount: number; delivery_fee: number; total_amount: number };
  paid: boolean;
  /** ยอดที่ลูกค้าโอนมาแล้ว (ใบที่ชำระแล้ว = ยอดสุทธิเดิม − รอชำระเพิ่มที่ค้าง) · ยังไม่ชำระ = 0 */
  paid_amount: number;
  /** ผลของการเปลี่ยน: ไม่มีส่วนต่าง / ร้านโอนคืน / ลูกค้าชำระเพิ่ม / ยังไม่ชำระ (QR ยอดใหม่) */
  outcome: "none" | "refund" | "extra" | "unpaid";
  refund: number;
  extra: number;
  refund_due_after: number;
  extra_due_after: number;
  /** รายการ เดิม → ใหม่ ต่อบรรทัด */
  lines: Array<{ name: string; extras: string[]; unit_price: number; old_qty: number; new_qty: number; status: "kept" | "changed" | "removed" | "added" }>;
  /** สินค้าที่โควตาในรอบไม่พอ (บันทึกจะไม่ผ่าน) */
  quota_errors: string[];
  /** สินค้าที่เพิ่มต่ำกว่าขั้นต่ำต่อรายการ — แจ้งเตือนเท่านั้น ร้านบันทึกได้ */
  below_min: Array<{ name: string; min_qty: number; quantity: number }>;
  /** ข้อความที่จะส่งถึงลูกค้า (LINE / กระดิ่ง) */
  customer_message: string;
}

const extrasOf = (l: any): string[] => [
  ...(l.product_snapshot?.variant_name ? [l.product_snapshot.variant_name] : []),
  ...(l.selected_options ?? []).map((o: any) => (o.text_value ? `${o.option_name}: ${o.text_value}` : o.option_name)),
];

/** POST /admin/preorders/:id/items/preview — ยอดจริงจาก backend ก่อนกดยืนยัน (กติกาเดียวกับ editPreorderItems ทุกอย่าง) */
export async function previewPreorderEdit(id: string, input: EditPreorderItemsInput): Promise<PreorderEditPreview> {
  const plan = await planEdit(id, input);
  const { p, current, keep, added, amounts, paid } = plan;

  const quota_errors: string[] = [];
  const need = [...plan.delta].filter(([, n]) => n > 0);
  if (need.length) {
    const items = await preorderRoundItemModel
      .find({ _id: { $in: need.map(([rid]) => rid) } })
      .populate("product_id", "product_name_th")
      .lean<any[]>();
    for (const [rid, n] of need) {
      const it = items.find((x) => String(x._id) === rid);
      const left = it ? Math.max(0, Number(it.max_qty_total ?? 0) - Number(it.current_qty ?? 0)) : 0;
      if (!it || !it.is_active || n > left) quota_errors.push(`${it?.product_id?.product_name_th ?? "สินค้า"} เหลือในรอบ ${left} ชิ้น (ต้องการเพิ่ม ${n})`);
    }
  }

  const lines: PreorderEditPreview["lines"] = [
    ...current.map((l) => {
      const q = keep.get(String(l._id)) ?? 0;
      return {
        name: l.product_snapshot?.product_name_th ?? "",
        extras: extrasOf(l),
        unit_price: Number(l.unit_price),
        old_qty: Number(l.quantity),
        new_qty: q,
        status: (q === 0 ? "removed" : q === Number(l.quantity) ? "kept" : "changed") as "kept" | "changed" | "removed",
      };
    }),
    ...added.map((l) => ({ name: l.product_snapshot.product_name_th, extras: extrasOf(l), unit_price: l.unit_price, old_qty: 0, new_qty: l.quantity, status: "added" as const })),
  ];

  const extraDueAfter = round2(Number(p.extra_due_amount ?? 0) + plan.extraInc);
  const after = lines.filter((l) => l.new_qty > 0).map((l) => ({ name: l.name, quantity: l.new_qty }));
  return {
    before: { subtotal: Number(p.subtotal), discount_amount: Number(p.discount_amount ?? 0), delivery_fee: Number(p.delivery_fee ?? 0), total_amount: Number(p.total_amount) },
    after: { subtotal: amounts.subtotal, discount_amount: amounts.discount_amount, delivery_fee: Number(p.delivery_fee ?? 0), total_amount: amounts.total_amount },
    paid,
    paid_amount: paid ? round2(Number(p.total_amount) - Number(p.extra_due_amount ?? 0)) : 0,
    outcome: !paid ? "unpaid" : plan.extra > 0 ? "extra" : plan.refund > 0 ? "refund" : "none",
    refund: plan.refund,
    extra: plan.extra,
    refund_due_after: Math.max(0, plan.refundDueAfter),
    extra_due_after: Math.max(0, extraDueAfter),
    lines,
    quota_errors,
    below_min: plan.belowMin,
    customer_message: customerMessages.preorderItemsChanged(p.preorder_no, linesText(after), amounts.total_amount, plan.refund, Math.max(0, extraDueAfter), new Date(Date.now() + EXTRA_PAYMENT_WINDOW_MS)),
  };
}

export async function editPreorderItems(id: string, input: EditPreorderItemsInput): Promise<EditPreorderItemsResult> {
  const { p, current, keep, keptTotal, added, amounts, paid, refundInc, extraInc, refund, extra, refundDueAfter, delta, newSubtotal, oldSubtotal } =
    await planEdit(id, input);
  if (paid && extra > 0 && !input.allow_extra_payment) {
    throw unprocessable(
      `ยอดสินค้าใหม่ ${newSubtotal.toLocaleString("th-TH")} บาท เกินยอดที่ลูกค้าชำระไว้ (${oldSubtotal.toLocaleString("th-TH")} บาท) — ยืนยันให้ลูกค้าชำระเพิ่มก่อน`,
      { code: "EXTRA_PAYMENT_REQUIRED" }
    );
  }

  const saga = new Saga();
  try {
    for (const [rid, n] of delta) {
      if (n <= 0) continue;
      await preorderRoundService.commitQty(rid, n);
      saga.onRollback(`releaseQty:${rid}`, () => preorderRoundService.releaseQty(rid, n));
    }

    const before = { subtotal: p.subtotal, discount_amount: p.discount_amount, total_amount: p.total_amount, refund_due_note: p.refund_due_note ?? null, extra_revert: p.extra_revert ?? null };
    // ชำระแล้วและยังมียอดเพิ่มค้าง = เก็บรายการ/ยอดก่อนเปลี่ยน + ให้เวลาชำระ 30 นาที (ไม่จ่าย = คืนรายการเดิม)
    const extraDueAfter = round2(Number(p.extra_due_amount ?? 0) + extraInc);
    const revertSet = paid ? { extra_revert: extraDueAfter > 0.005 ? buildRevertSnapshot(p, current) : null } : {};
    const removedLabels = current
      .filter((l) => !keep.has(String(l._id)))
      .map((l) => lineLabel(l.product_snapshot?.product_name_th ?? "", Number(l.quantity)));
    const note = refund > 0 ? `เปลี่ยนสินค้า${removedLabels.length ? ` (${removedLabels.join(", ")})` : ""}` : null;
    const noteSet = note
      ? { refund_due_note: p.refund_due_note ? `${p.refund_due_note}, ${note}` : note }
      : refundInc < 0 && refundDueAfter <= 0
        ? { refund_due_note: null } // ยอดเพิ่มหักรอโอนคืนจนหมด
        : {};
    // subtotal เป็นเงื่อนไข — กันแก้ซ้อนกันสองหน้าจอ
    const claimed = await preorderModel.findOneAndUpdate(
      { _id: p._id, deleted_at: null, order_status: p.order_status, subtotal: p.subtotal },
      {
        $set: {
          subtotal: amounts.subtotal,
          discount_amount: amounts.discount_amount,
          total_amount: amounts.total_amount,
          ...noteSet,
          ...revertSet,
        },
        $inc: { refund_due_amount: refundInc, extra_due_amount: extraInc },
      },
      { returnDocument: "after" }
    );
    if (!claimed) throw conflict("คำสั่งซื้อเปลี่ยนไปแล้ว กรุณาโหลดใหม่แล้วลองอีกครั้ง");
    saga.onRollback("restore-preorder", () =>
      preorderModel.updateOne({ _id: p._id }, { $set: before, $inc: { refund_due_amount: -refundInc, extra_due_amount: -extraInc } })
    );

    // รายการเดิม: เอาออก = soft delete (เก็บประวัติ) · เปลี่ยนจำนวน = คิดยอดบรรทัดใหม่จากราคาเดิม
    const now = new Date();
    const reason = input.reason?.trim() || "ร้านเปลี่ยนสินค้าตามที่ตกลงกับลูกค้า";
    for (const l of current) {
      const qty = keep.get(String(l._id));
      if (qty === Number(l.quantity)) continue;
      const undo = { quantity: l.quantity, total_price: l.total_price, deleted_at: null, cancelled_at: l.cancelled_at ?? null, cancelled_reason: l.cancelled_reason ?? null };
      await preorderItemModel.updateOne(
        { _id: l._id },
        qty == null
          ? { $set: { deleted_at: now, cancelled_at: now, cancelled_reason: reason } }
          : { $set: { quantity: qty, total_price: keptTotal(l) } }
      );
      saga.onRollback(`restore-item:${l._id}`, () => preorderItemModel.updateOne({ _id: l._id }, { $set: undo }));
    }
    if (added.length) {
      const docs = added.map((l) => ({ ...l, _id: new mongoose.Types.ObjectId() }));
      await preorderItemModel.insertMany(docs);
      saga.onRollback("delete-added", () => preorderItemModel.deleteMany({ _id: { $in: docs.map((d) => d._id) } }));
    }

    saga.commit();
  } catch (err) {
    await saga.rollback();
    throw err;
  }

  for (const [rid, n] of delta) if (n < 0) await preorderRoundService.releaseQty(rid, -n);
  if (paid) {
    // ชำระแล้ว: payment เดิมคงยอดที่รับจริง · ยอดรอชำระเพิ่มเปลี่ยน → ออก/แก้/ลบ payment ยอดเพิ่ม
    if (extraInc !== 0) await syncExtraPayment(p._id);
  } else {
    // ยังไม่จ่าย = QR ต้องออกยอดใหม่
    await paymentModel.updateMany(
      { preorder_id: p._id, status: "pending", deleted_at: null, slip_image_url: { $in: [null, ""] }, group_id: null, is_extra: { $ne: true } },
      { $set: { amount: amounts.total_amount } }
    );
  }

  const fresh = await preorderModel.findById(p._id).select("extra_due_amount extra_revert.expires_at").lean<any>();
  const extraDue = round2(Number(fresh?.extra_due_amount ?? 0));
  const lines = await preorderItemModel.find({ preorder_id: p._id, deleted_at: null }).lean<any[]>();
  const text = customerMessages.preorderItemsChanged(
    p.preorder_no,
    lines.map((l) => lineLabel(l.product_snapshot?.product_name_th ?? "", Number(l.quantity))).join(", "),
    amounts.total_amount,
    refund,
    extraDue,
    fresh?.extra_revert?.expires_at ?? null
  );
  const notice = customerWeb.fromLineText("preorder", p._id, p.preorder_no, text, "warning");
  notifyCustomerLater(p.user_id, text, extraDue > 0 && notice ? customerWeb.extraPaymentDue(notice, extraDue) : notice);
  return { preorder: await getPreorderById(id), refund, extra, extra_due: extraDue };
}
