/* eslint-disable @typescript-eslint/no-explicit-any */
// ยอด "รอชำระเพิ่ม" — ร้านเปลี่ยนสินค้าในพรีออเดอร์ที่ชำระแล้วจนยอดเกิน (preorderExtraPaymentService)
import { describe, it, expect } from "vitest";
import preorderModel from "@/models/preorderModel";
import preorderItemModel from "@/models/preorderItemModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import paymentModel from "@/models/paymentModel";
import { editPreorderItems, previewPreorderEdit } from "@/services/preorderEditService";
import { createPayment, getPaymentPage, submitSlip, verifyPayment } from "@/services/paymentService";
import { cancelPreorder } from "@/services/preorderService";
import { makePreorder, makeProduct, makeUser } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const SLIP = "/api/files/slips/extra.jpg";

/** ใบชำระแล้ว: เค้ก 2 × 150 = 300 · ส่วนลด 30 · ค่าส่ง 50 = 320 (payment 320 paid) · ขนมปัง 100 ในรอบเดียวกัน */
async function setup() {
  const customer = await makeUser();
  const admin = await makeUser();
  const round = await preorderRoundModel.create({
    round_name: "รอบยอดเพิ่ม",
    round_status: "open",
    created_by: admin._id,
    open_date: new Date(Date.now() - DAY),
    close_date: new Date(Date.now() + DAY),
    pickup_date: new Date(Date.now() + 3 * DAY),
  });
  const cake = await makeProduct({ product_name_th: "เค้กเดิม", product_price: 150 });
  const bread = await makeProduct({ product_name_th: "ขนมปังใหม่", product_price: 100 });
  const cakeItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: cake._id, max_qty_total: 50, current_qty: 2 });
  const breadItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: bread._id, max_qty_total: 50, current_qty: 0 });
  const p = await makePreorder(String(customer._id), {
    round_id: round._id, order_type: "takeaway", order_status: "preparing", payment_status: "paid",
    subtotal: 300, discount_amount: 30, delivery_fee: 50, total_amount: 320,
  });
  const line = await preorderItemModel.create({
    preorder_id: p._id, round_item_id: cakeItem._id, product_id: cake._id,
    product_snapshot: { product_name_th: "เค้กเดิม", product_name_eng: "cake" },
    pickup_date: new Date(Date.now() + 3 * DAY), quantity: 2, unit_price: 150, total_price: 300,
  });
  const main = await paymentModel.create({ preorder_id: p._id, user_id: customer._id, amount: 320, status: "paid" });
  await preorderModel.updateOne({ _id: p._id }, { $set: { payment_id: main._id } });
  return { customer, admin, p, line, breadItem, main };
}

const addBread = (ctx: Awaited<ReturnType<typeof setup>>, quantity = 1, allow = true) =>
  editPreorderItems(String(ctx.p._id), {
    keep: [{ item_id: String(ctx.line._id), quantity: 2 }],
    add: [{ round_item_id: String(ctx.breadItem._id), quantity }],
    allow_extra_payment: allow,
  });

const extraPayments = (id: unknown) => paymentModel.find({ preorder_id: id, is_extra: true, deleted_at: null }).lean<any[]>();

describe("preorder extra payment", () => {
  it("ไม่ยืนยัน → 422 EXTRA_PAYMENT_REQUIRED", async () => {
    const ctx = await setup();
    await expect(addBread(ctx, 1, false)).rejects.toMatchObject({ status: 422, details: { code: "EXTRA_PAYMENT_REQUIRED" } });
    expect(await extraPayments(ctx.p._id)).toHaveLength(0);
  });

  it("ยืนยันแล้ว: ยอดเพิ่ม → รอชำระเพิ่ม + payment ยอดเพิ่ม · ลูกค้าจ่ายที่หน้าเดิม · ยืนยันสลิปแล้วหมดยอดค้าง", async () => {
    const ctx = await setup();
    const r = await addBread(ctx);

    expect(r).toMatchObject({ refund: 0, extra: 100, extra_due: 100 });
    expect(await preorderModel.findById(ctx.p._id).lean<any>()).toMatchObject({
      subtotal: 400, total_amount: 420, extra_due_amount: 100, payment_status: "paid", payment_id: ctx.main._id,
    });
    const [extra] = await extraPayments(ctx.p._id);
    expect(extra).toMatchObject({ amount: 100, status: "pending" });

    const page = await getPaymentPage("preorder", String(ctx.p._id), String(ctx.customer._id));
    expect(page).toMatchObject({ can_pay: true, amount: 100, extra_due: 100, payment_id: String(extra._id), payment_due_at: null, group_id: null });

    await submitSlip(String(extra._id), { slip_image_url: SLIP }, { notify: false });
    await verifyPayment(String(extra._id), { verified_by: String(ctx.admin._id), approved: true });
    expect(await preorderModel.findById(ctx.p._id).lean<any>()).toMatchObject({ extra_due_amount: 0, payment_status: "paid" });
    const done = await getPaymentPage("preorder", String(ctx.p._id), String(ctx.customer._id));
    expect(done).toMatchObject({ can_pay: false, extra_due: 0 });
  });

  it("สลิปยอดเพิ่มถูกปฏิเสธ: สถานะใบยัง paid · ยอดค้างเท่าเดิม", async () => {
    const ctx = await setup();
    await addBread(ctx);
    const [extra] = await extraPayments(ctx.p._id);
    await submitSlip(String(extra._id), { slip_image_url: SLIP }, { notify: false });
    await verifyPayment(String(extra._id), { verified_by: String(ctx.admin._id), approved: false });
    expect(await preorderModel.findById(ctx.p._id).lean<any>()).toMatchObject({ extra_due_amount: 100, payment_status: "paid" });
  });

  it("แก้อีกรอบให้ถูกลง: หักรอชำระเพิ่มก่อน ลบ payment ยอดเพิ่ม · ส่วนที่เหลือเป็นรอโอนคืน", async () => {
    const ctx = await setup();
    await addBread(ctx);
    // เหลือเค้ก 1 ชิ้น: ยอดสินค้า 150 (ลด 250 จาก 400 · ส่วนลดตามสัดส่วน)
    const r = await editPreorderItems(String(ctx.p._id), { keep: [{ item_id: String(ctx.line._id), quantity: 1 }], add: [] });
    const after = await preorderModel.findById(ctx.p._id).lean<any>();
    expect(after.extra_due_amount).toBe(0);
    expect(r.refund).toBe(round2(420 - after.total_amount - 100));
    expect(after.refund_due_amount).toBe(r.refund);
    expect(await extraPayments(ctx.p._id)).toHaveLength(0);
  });

  it("มีรอโอนคืนค้าง แล้วเพิ่มสินค้า: หักรอโอนคืนก่อน ส่วนเกินเป็นรอชำระเพิ่ม", async () => {
    const ctx = await setup();
    // เค้กเหลือ 1: ลด 150 · ส่วนลดสัดส่วน 15 → รอโอนคืน 135 · ยอด 185
    await editPreorderItems(String(ctx.p._id), { keep: [{ item_id: String(ctx.line._id), quantity: 1 }], add: [] });
    expect(await preorderModel.findById(ctx.p._id).lean<any>()).toMatchObject({ refund_due_amount: 135, total_amount: 185 });

    // + ขนมปัง 3 (300) → ยอด 150 + 300 − 15 + 50 = 485 · เพิ่ม 300 → หักรอโอนคืน 135 · ชำระเพิ่ม 165
    const r = await editPreorderItems(String(ctx.p._id), {
      keep: [{ item_id: String(ctx.line._id), quantity: 1 }],
      add: [{ round_item_id: String(ctx.breadItem._id), quantity: 3 }],
      allow_extra_payment: true,
    });
    expect(r).toMatchObject({ refund: 0, extra: 165, extra_due: 165 });
    expect(await preorderModel.findById(ctx.p._id).lean<any>()).toMatchObject({ refund_due_amount: 0, refund_due_note: null, extra_due_amount: 165, total_amount: 485 });
    expect((await extraPayments(ctx.p._id))[0]).toMatchObject({ amount: 165 });
  });

  it("payment ยอดเพิ่มหาย → ลูกค้าสร้างใหม่ได้เฉพาะยอดเพิ่ม", async () => {
    const ctx = await setup();
    await addBread(ctx);
    await paymentModel.updateMany({ preorder_id: ctx.p._id, is_extra: true }, { $set: { deleted_at: new Date() } });

    await expect(
      createPayment({ user_id: String(ctx.customer._id), preorder_id: String(ctx.p._id), amount: 420 })
    ).rejects.toMatchObject({ status: 400 });
    const pay = await createPayment({ user_id: String(ctx.customer._id), preorder_id: String(ctx.p._id), amount: 100 });
    expect(pay).toMatchObject({ amount: 100, is_extra: true, status: "pending" });
    expect((await preorderModel.findById(ctx.p._id).lean<any>()).payment_id).toEqual(ctx.main._id);
  });

  it("ต่ำกว่าขั้นต่ำต่อรายการ: preview เตือน (below_min) · ร้านบันทึกได้", async () => {
    const ctx = await setup();
    await preorderRoundItemModel.updateOne({ _id: ctx.breadItem._id }, { $set: { min_order_qty: 2 } });
    const pv = await previewPreorderEdit(String(ctx.p._id), {
      keep: [{ item_id: String(ctx.line._id), quantity: 2 }],
      add: [{ round_item_id: String(ctx.breadItem._id), quantity: 1 }],
      allow_extra_payment: true,
    });
    expect(pv.below_min).toEqual([{ name: "ขนมปังใหม่", min_qty: 2, quantity: 1 }]);
    const r = await addBread(ctx, 1);
    expect(r.extra).toBe(100);
    expect(await preorderItemModel.countDocuments({ preorder_id: ctx.p._id, round_item_id: ctx.breadItem._id, quantity: 1, deleted_at: null })).toBe(1);
  });

  it("preview: ยอดจริงก่อนบันทึก · ไม่เขียนอะไร · บอกโควตาไม่พอ", async () => {
    const ctx = await setup();
    const pv = await previewPreorderEdit(String(ctx.p._id), {
      keep: [{ item_id: String(ctx.line._id), quantity: 1 }],
      add: [{ round_item_id: String(ctx.breadItem._id), quantity: 3 }],
    });
    // 150 + 300 = 450 − 30 + 50 = 470 · ชำระไว้ 320 → ชำระเพิ่ม 150
    expect(pv).toMatchObject({
      outcome: "extra", extra: 150, refund: 0, extra_due_after: 150, paid_amount: 320, quota_errors: [],
      before: { subtotal: 300, total_amount: 320 }, after: { subtotal: 450, total_amount: 470 },
    });
    expect(pv.lines.map((l) => [l.name, l.old_qty, l.new_qty, l.status])).toEqual([
      ["เค้กเดิม", 2, 1, "changed"],
      ["ขนมปังใหม่", 0, 3, "added"],
    ]);
    expect(pv.customer_message).toContain("ชำระเงินเพิ่ม 150");
    expect(await preorderModel.findById(ctx.p._id).lean<any>()).toMatchObject({ subtotal: 300, extra_due_amount: 0 });
    expect(await extraPayments(ctx.p._id)).toHaveLength(0);

    await preorderRoundItemModel.updateOne({ _id: ctx.breadItem._id }, { $set: { max_qty_total: 2 } });
    const short = await previewPreorderEdit(String(ctx.p._id), { keep: [], add: [{ round_item_id: String(ctx.breadItem._id), quantity: 3 }] });
    expect(short.quota_errors).toHaveLength(1);
    expect(short.outcome).toBe("none"); // เค้ก 300 ออก · ขนมปัง 300 เข้า = ยอดเท่าเดิม
  });

  it("ยกเลิกใบที่ชำระยอดเพิ่มแล้ว → คืนเงินทุก payment", async () => {
    const ctx = await setup();
    await addBread(ctx);
    const [extra] = await extraPayments(ctx.p._id);
    await submitSlip(String(extra._id), { slip_image_url: SLIP }, { notify: false });
    await verifyPayment(String(extra._id), { verified_by: String(ctx.admin._id), approved: true });

    await cancelPreorder(String(ctx.p._id), { cancelled_by: String(ctx.admin._id), cancelled_reason: "ทดสอบ" });
    const pays = await paymentModel.find({ preorder_id: ctx.p._id, deleted_at: null }).lean<any[]>();
    expect(pays.map((x) => x.status).sort()).toEqual(["refunded", "refunded"]);
    expect((await preorderModel.findById(ctx.p._id).lean<any>()).payment_status).toBe("refunded");
  });
});

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
