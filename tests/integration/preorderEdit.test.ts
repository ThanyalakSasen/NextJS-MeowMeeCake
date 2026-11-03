/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import preorderModel from "@/models/preorderModel";
import preorderItemModel from "@/models/preorderItemModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import paymentModel from "@/models/paymentModel";
import { editPreorderItems, updatePreorderAddress } from "@/services/preorderEditService";
import { makePreorder, makeProduct, makeUser } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

async function setup(roundStatus = "open") {
  const customer = await makeUser();
  const round = await preorderRoundModel.create({
    round_name: "รอบแก้ไข",
    round_status: roundStatus,
    created_by: customer._id,
    open_date: new Date(Date.now() - DAY),
    close_date: new Date(Date.now() + DAY),
    pickup_date: new Date(Date.now() + 3 * DAY),
  });
  const cake = await makeProduct({ product_name_th: "เค้กเดิม", product_price: 150 });
  const bread = await makeProduct({ product_name_th: "ขนมปังใหม่", product_price: 100 });
  const cakeItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: cake._id, max_qty_total: 50, current_qty: 2 });
  const breadItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: bread._id, max_qty_total: 50, current_qty: 5 });
  return { customer, round, cakeItem, breadItem };
}

/** ใบ: เค้ก 2 × 150 = 300 · ส่วนลด 30 · ค่าส่ง 50 = 320 */
async function makeOrder(ctx: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) {
  const p = await makePreorder(String(ctx.customer._id), {
    round_id: ctx.round._id, order_type: "delivery", order_status: "preparing", payment_status: "paid",
    subtotal: 300, discount_amount: 30, delivery_fee: 50, total_amount: 320,
    delivery_address: { recipient_name: "ก", recipient_phone: "0812345678", house_no: "1", sub_district: "ในเมือง", district: "เมือง", province: "ขอนแก่น", zip_code: "40000" },
    ...over,
  });
  const line = await preorderItemModel.create({
    preorder_id: p._id, round_item_id: ctx.cakeItem._id, product_id: ctx.cakeItem.product_id,
    product_snapshot: { product_name_th: "เค้กเดิม", product_name_eng: "cake" },
    pickup_date: new Date(Date.now() + 3 * DAY), quantity: 2, unit_price: 150, total_price: 300,
  });
  return { p, line };
}

const qtyOf = async (id: unknown) => (await preorderRoundItemModel.findById(id).lean<any>()).current_qty;

describe("editPreorderItems", () => {
  it("ชำระแล้ว เปลี่ยนเป็นสินค้าที่ถูกกว่า: คิดยอดใหม่ · ส่วนต่างเข้ารอโอนคืน · ย้ายโควตา", async () => {
    const ctx = await setup();
    const { p, line } = await makeOrder(ctx);

    const r = await editPreorderItems(String(p._id), { keep: [], add: [{ round_item_id: String(ctx.breadItem._id), quantity: 2 }] });

    // ลดค่าสินค้า 100 → ส่วนลดของส่วนนั้น 10 → คืน 90
    expect(r.refund).toBe(90);
    const after = await preorderModel.findById(p._id).lean<any>();
    expect(after).toMatchObject({ subtotal: 200, discount_amount: 20, total_amount: 230, refund_due_amount: 90, payment_status: "paid" });
    expect(after.refund_due_note).toContain("เค้กเดิม × 2");
    const lines = await preorderItemModel.find({ preorder_id: p._id, deleted_at: null }).lean<any[]>();
    expect(lines.map((l) => [l.product_snapshot.product_name_th, l.quantity, l.total_price])).toEqual([["ขนมปังใหม่", 2, 200]]);
    expect((await preorderItemModel.findById(line._id).lean<any>()).cancelled_at).toBeTruthy();
    expect(await qtyOf(ctx.cakeItem._id)).toBe(0);
    expect(await qtyOf(ctx.breadItem._id)).toBe(7);
  });

  it("ชำระแล้ว ยอดใหม่เกินที่ชำระ → 422 ไม่เปลี่ยนอะไร", async () => {
    const ctx = await setup();
    const { p } = await makeOrder(ctx);

    await expect(
      editPreorderItems(String(p._id), { keep: [{ item_id: String((await preorderItemModel.findOne({ preorder_id: p._id }))!._id), quantity: 2 }], add: [{ round_item_id: String(ctx.breadItem._id), quantity: 1 }] })
    ).rejects.toMatchObject({ status: 422 });
    expect(await preorderModel.findById(p._id).lean<any>()).toMatchObject({ subtotal: 300, total_amount: 320, refund_due_amount: 0 });
    expect(await qtyOf(ctx.breadItem._id)).toBe(5);
    expect(await preorderItemModel.countDocuments({ preorder_id: p._id, deleted_at: null })).toBe(1);
  });

  it("ยังไม่ชำระ: เพิ่มยอดได้ · QR ออกยอดใหม่ · ไม่มีรอโอนคืน", async () => {
    const ctx = await setup();
    const { p, line } = await makeOrder(ctx, { payment_status: "pending", order_status: "pending" });
    await paymentModel.create({ preorder_id: p._id, user_id: ctx.customer._id, amount: 320, status: "pending" });

    const r = await editPreorderItems(String(p._id), {
      keep: [{ item_id: String(line._id), quantity: 3 }],
      add: [{ round_item_id: String(ctx.breadItem._id), quantity: 1 }],
    });

    expect(r.refund).toBe(0);
    // 3 × 150 + 100 = 550 − ส่วนลด 30 + ค่าส่ง 50
    expect(await preorderModel.findById(p._id).lean<any>()).toMatchObject({ subtotal: 550, discount_amount: 30, total_amount: 570, refund_due_amount: 0 });
    expect((await paymentModel.findOne({ preorder_id: p._id }).lean<any>()).amount).toBe(570);
    expect(await qtyOf(ctx.cakeItem._id)).toBe(3);
    expect(await qtyOf(ctx.breadItem._id)).toBe(6);
  });

  it("โควตาไม่พอ → 409 คืนโควตาที่จองไปแล้ว", async () => {
    const ctx = await setup();
    const { p } = await makeOrder(ctx, { payment_status: "pending", order_status: "pending" });
    await preorderRoundItemModel.updateOne({ _id: ctx.breadItem._id }, { $set: { max_qty_total: 5 } });

    await expect(
      editPreorderItems(String(p._id), { keep: [], add: [{ round_item_id: String(ctx.breadItem._id), quantity: 1 }] })
    ).rejects.toMatchObject({ status: 409 });
    expect(await qtyOf(ctx.breadItem._id)).toBe(5);
    expect(await qtyOf(ctx.cakeItem._id)).toBe(2);
    expect(await preorderItemModel.countDocuments({ preorder_id: p._id, deleted_at: null })).toBe(1);
  });

  it("รอบปิดรับแล้ว / สลิปรอตรวจ / ใบเตรียมเสร็จ / ไม่เหลือสินค้า → แก้ไม่ได้", async () => {
    const closed = await setup("closed");
    const { p: p1 } = await makeOrder(closed);
    await expect(
      editPreorderItems(String(p1._id), { keep: [], add: [{ round_item_id: String(closed.breadItem._id), quantity: 1 }] })
    ).rejects.toMatchObject({ status: 409 });

    const ctx = await setup();
    const { p: p2 } = await makeOrder(ctx, { payment_status: "pending", order_status: "pending" });
    await paymentModel.create({ preorder_id: p2._id, user_id: ctx.customer._id, amount: 320, status: "pending", slip_image_url: "https://x/slip.jpg" });
    await expect(
      editPreorderItems(String(p2._id), { keep: [], add: [{ round_item_id: String(ctx.breadItem._id), quantity: 1 }] })
    ).rejects.toMatchObject({ status: 409 });

    const { p: p3 } = await makeOrder(ctx, { order_status: "ready" });
    await expect(
      editPreorderItems(String(p3._id), { keep: [], add: [{ round_item_id: String(ctx.breadItem._id), quantity: 1 }] })
    ).rejects.toMatchObject({ status: 409 });

    const { p: p4 } = await makeOrder(ctx);
    await expect(editPreorderItems(String(p4._id), { keep: [], add: [] })).rejects.toMatchObject({ status: 400 });
  });
});

describe("updatePreorderAddress", () => {
  const address = { recipient_name: "คุณใหม่", recipient_phone: "0899999999", house_no: "99/9", sub_district: "ศิลา", district: "เมือง", province: "ขอนแก่น", zip_code: "40000" };

  it("แบบจัดส่ง: แก้ผู้รับ + ที่อยู่ · ค่าส่งคงเดิม", async () => {
    const ctx = await setup();
    const { p } = await makeOrder(ctx);
    await updatePreorderAddress(String(p._id), address);
    expect(await preorderModel.findById(p._id).lean<any>()).toMatchObject({ delivery_address: address, delivery_fee: 50, total_amount: 320 });
  });

  it("รับเอง หรือจัดส่งไปแล้ว → 409", async () => {
    const ctx = await setup();
    const { p: takeaway } = await makeOrder(ctx, { order_type: "takeaway", delivery_address: null });
    await expect(updatePreorderAddress(String(takeaway._id), address)).rejects.toMatchObject({ status: 409 });
    const { p: shipped } = await makeOrder(ctx, { delivery_status: "shipping" });
    await expect(updatePreorderAddress(String(shipped._id), address)).rejects.toMatchObject({ status: 409 });
  });
});
