/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import preorderModel from "@/models/preorderModel";
import preorderItemModel from "@/models/preorderItemModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import paymentModel from "@/models/paymentModel";
import productionItemModel from "@/models/productionItemModel";
import promotionModel from "@/models/promotionModel";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as productionOrderService from "@/services/productionOrderService";
import { cancelRoundItem, markRefundDone } from "@/services/preorderItemCancelService";
import { computeItemCancellation } from "@/lib/preorderItemCancellation";
import { makePreorder, makeProduct, makeRecipe, makeUser } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

async function makeRound(createdBy: unknown) {
  return preorderRoundModel.create({
    round_name: "รอบทดสอบ",
    round_status: "open",
    created_by: createdBy,
    open_date: new Date(Date.now() - DAY),
    close_date: new Date(Date.now() + DAY),
    pickup_date: new Date(Date.now() + 3 * DAY),
  });
}

async function setup() {
  const customer = await makeUser();
  const admin = await makeUser();
  const round = await makeRound(admin._id);
  const keep = await makeProduct({ product_name_th: "ขนมเก็บไว้" });
  const drop = await makeProduct({ product_name_th: "ขนมยกเลิก" });
  const keepItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: keep._id, max_qty_total: 50, current_qty: 2 });
  const dropItem = await preorderRoundItemModel.create({ round_id: round._id, product_id: drop._id, max_qty_total: 50, current_qty: 5 });
  return { customer, admin, round, keep, drop, keepItem, dropItem };
}

async function addLine(preorder: { _id: unknown }, roundItem: { _id: unknown; product_id: unknown }, name: string, qty: number, unit: number) {
  return preorderItemModel.create({
    preorder_id: preorder._id,
    round_item_id: roundItem._id,
    product_id: roundItem.product_id,
    product_snapshot: { product_name_th: name, product_name_eng: name },
    pickup_date: new Date(Date.now() + 3 * DAY),
    quantity: qty,
    unit_price: unit,
    total_price: qty * unit,
  });
}

describe("computeItemCancellation", () => {
  it("คืนเท่าที่จ่ายจริง: ส่วนลดสินค้าลดตามสัดส่วน ค่าส่งคงไว้", () => {
    // สินค้า 300 + 100 ลด 40 ค่าส่ง 50 = จ่าย 410 · ยกเลิก 100 = ส่วนลดของสินค้านี้ 10 คืน 90
    const r = computeItemCancellation({ subtotal: 400, discount_amount: 40, total_amount: 410 }, 100);
    expect(r).toEqual({ subtotal: 300, discount_amount: 30, total_amount: 320, refund: 90 });
  });

  it("ส่วนลดค่าส่งไม่ถูกหักจากเงินคืน", () => {
    // ส่งฟรี 50: จ่ายค่าสินค้าเต็ม 400 · ยกเลิก 100 ต้องได้คืนเต็ม 100
    const r = computeItemCancellation({ subtotal: 400, discount_amount: 50, total_amount: 400 }, 100, 50);
    expect(r).toEqual({ subtotal: 300, discount_amount: 50, total_amount: 300, refund: 100 });
  });

  it("ไม่รับการยกเลิกทั้งใบ — เส้นทางนั้นใช้ cancelPreorder", () => {
    expect(() => computeItemCancellation({ subtotal: 100, discount_amount: 0, total_amount: 100 }, 100)).toThrow();
  });
});

describe("cancelRoundItem", () => {
  it("ใบที่มีสินค้าอื่น: ตัดเฉพาะสินค้านี้ · คิดยอดใหม่ · รอโอนคืน · ไม่ตั้ง refunded", async () => {
    const { customer, admin, round, keepItem, dropItem } = await setup();
    const p = await makePreorder(String(customer._id), {
      round_id: round._id, payment_status: "paid", order_status: "preparing",
      subtotal: 400, discount_amount: 40, delivery_fee: 50, total_amount: 410,
    });
    await addLine(p, keepItem, "ขนมเก็บไว้", 2, 150);
    await addLine(p, dropItem, "ขนมยกเลิก", 2, 50);
    const payment = await paymentModel.create({ preorder_id: p._id, user_id: customer._id, amount: 410, status: "paid" });

    const r = await cancelRoundItem(String(dropItem._id), { cancelled_by: String(admin._id) });

    expect(r).toMatchObject({ removed: true, updated_orders: [p.preorder_no], cancelled_orders: [], refund_total: 90, failed: [] });
    const after = await preorderModel.findById(p._id).lean<any>();
    expect(after).toMatchObject({
      order_status: "preparing", payment_status: "paid", subtotal: 300, discount_amount: 30, total_amount: 320,
      refund_due_amount: 90, refund_due_note: "ขนมยกเลิก × 2",
    });
    expect(await preorderItemModel.countDocuments({ preorder_id: p._id, deleted_at: null })).toBe(1);
    expect((await paymentModel.findById(payment._id).lean<any>()).amount).toBe(410);
    expect((await preorderRoundItemModel.findById(dropItem._id).lean<any>()).deleted_at).not.toBeNull();
  });

  it("ใบที่มีแต่สินค้านี้: ยกเลิกทั้งใบ · ชำระแล้วค้างรอโอนคืน", async () => {
    const { customer, admin, round, dropItem } = await setup();
    const p = await makePreorder(String(customer._id), {
      round_id: round._id, payment_status: "paid", order_status: "preparing", subtotal: 150, total_amount: 150,
    });
    await addLine(p, dropItem, "ขนมยกเลิก", 3, 50);
    await paymentModel.create({ preorder_id: p._id, user_id: customer._id, amount: 150, status: "paid" });

    const r = await cancelRoundItem(String(dropItem._id), { cancelled_by: String(admin._id) });

    expect(r).toMatchObject({ cancelled_orders: [p.preorder_no], refund_total: 150, removed: true });
    const after = await preorderModel.findById(p._id).lean<any>();
    expect(after.order_status).toBe("cancelled");
    expect(after.payment_status).toBe("paid");
  });

  it("ยังไม่จ่าย: ไม่มียอดคืน · ยอด QR ที่ค้างอยู่เป็นยอดใหม่", async () => {
    const { customer, admin, round, keepItem, dropItem } = await setup();
    const p = await makePreorder(String(customer._id), { round_id: round._id, subtotal: 200, total_amount: 200 });
    await addLine(p, keepItem, "ขนมเก็บไว้", 2, 50);
    await addLine(p, dropItem, "ขนมยกเลิก", 2, 50);
    const payment = await paymentModel.create({ preorder_id: p._id, user_id: customer._id, amount: 200, status: "pending" });

    const r = await cancelRoundItem(String(dropItem._id), { cancelled_by: String(admin._id) });

    expect(r.refunds).toEqual([]);
    expect((await preorderModel.findById(p._id).lean<any>()).refund_due_amount).toBe(0);
    expect((await paymentModel.findById(payment._id).lean<any>()).amount).toBe(100);
  });

  it("สินค้าที่ยกเลิกไม่เข้าใบสั่งผลิตตอนปิดรอบ สินค้าที่เหลือเข้าครบ", async () => {
    const { customer, admin, round, keep, keepItem, dropItem } = await setup();
    await makeRecipe(String(keep._id));
    const p = await makePreorder(String(customer._id), {
      round_id: round._id, payment_status: "paid", order_status: "preparing", subtotal: 200, total_amount: 200,
    });
    await addLine(p, keepItem, "ขนมเก็บไว้", 2, 50);
    await addLine(p, dropItem, "ขนมยกเลิก", 2, 50);
    await paymentModel.create({ preorder_id: p._id, user_id: customer._id, amount: 200, status: "paid" });

    await cancelRoundItem(String(dropItem._id), { cancelled_by: String(admin._id) });
    await preorderRoundModel.updateOne({ _id: round._id }, { $set: { round_status: "closed" } });
    const order: any = await productionOrderService.createProductionFromRound({
      round_id: String(round._id),
      production_date: new Date(),
    });

    const items = await productionItemModel.find({ production_order_id: order._id, deleted_at: null }).lean<any[]>();
    expect(items.map((i) => [String(i.product_id), i.planned_qty])).toEqual([[String(keep._id), 2]]);
  });

  it("กันทั้งรายการเมื่อมีสลิปรอตรวจ — ไม่แตะอะไรเลย สินค้ายังขายต่อ", async () => {
    const { customer, admin, round, dropItem } = await setup();
    const p = await makePreorder(String(customer._id), { round_id: round._id, subtotal: 100, total_amount: 100 });
    await addLine(p, dropItem, "ขนมยกเลิก", 2, 50);
    await paymentModel.create({ preorder_id: p._id, user_id: customer._id, amount: 100, status: "pending", slip_image_url: "slip.png" });

    await expect(cancelRoundItem(String(dropItem._id), { cancelled_by: String(admin._id) })).rejects.toThrow(/ตรวจสลิป/);

    expect((await preorderRoundItemModel.findById(dropItem._id).lean<any>()).is_active).toBe(true);
    expect((await preorderModel.findById(p._id).lean<any>()).order_status).toBe("pending");
  });

  it("กันเมื่อมีคำสั่งซื้อเตรียมเสร็จแล้ว และรอบที่ปิดแล้ว", async () => {
    const { customer, admin, round, dropItem } = await setup();
    const p = await makePreorder(String(customer._id), { round_id: round._id, order_status: "ready", payment_status: "paid", subtotal: 100, total_amount: 100 });
    await addLine(p, dropItem, "ขนมยกเลิก", 2, 50);
    await expect(cancelRoundItem(String(dropItem._id), { cancelled_by: String(admin._id) })).rejects.toThrow(/เตรียมสินค้าเสร็จ/);

    await preorderRoundModel.updateOne({ _id: round._id }, { $set: { round_status: "closed" } });
    await expect(cancelRoundItem(String(dropItem._id), { cancelled_by: String(admin._id) })).rejects.toThrow(/เปิดรับอยู่/);
  });

  it("ไม่มีคนจอง: เอาออกจากรอบเฉย ๆ", async () => {
    const { admin, dropItem } = await setup();
    await preorderRoundItemModel.updateOne({ _id: dropItem._id }, { $set: { current_qty: 0 } });
    const r = await cancelRoundItem(String(dropItem._id), { cancelled_by: String(admin._id) });
    expect(r).toMatchObject({ removed: true, cancelled_orders: [], updated_orders: [], refund_total: 0 });
    await expect(preorderRoundService.removeRoundItem(String(dropItem._id))).rejects.toThrow();
  });

  it("ส่งฟรี: ใช้โปรส่งฟรีแล้วคืนค่าสินค้าเต็ม", async () => {
    const { customer, admin, round, keepItem, dropItem } = await setup();
    const promo = await promotionModel.create({
      promotion_code: `FREE${Date.now()}`, promotion_name: "ส่งฟรี", discount_type: "FreeShipping", discount_value: 0, created_by: admin._id,
      start_date: new Date(Date.now() - DAY), end_date: new Date(Date.now() + DAY),
    });
    const p = await makePreorder(String(customer._id), {
      round_id: round._id, payment_status: "paid", order_status: "preparing", promotion_id: promo._id,
      subtotal: 200, discount_amount: 50, delivery_fee: 50, total_amount: 200,
    });
    await addLine(p, keepItem, "ขนมเก็บไว้", 2, 50);
    await addLine(p, dropItem, "ขนมยกเลิก", 2, 50);

    const r = await cancelRoundItem(String(dropItem._id), { cancelled_by: String(admin._id) });
    expect(r.refund_total).toBe(100);
  });
});

describe("markRefundDone", () => {
  it("ย้ายยอดรอโอนเป็นโอนแล้ว · กดซ้ำไม่ได้", async () => {
    const customer = await makeUser();
    const p = await makePreorder(String(customer._id), { payment_status: "paid", refund_due_amount: 90, refund_due_note: "ขนม × 2" });

    await markRefundDone(String(p._id));

    expect(await preorderModel.findById(p._id).lean<any>()).toMatchObject({ refund_due_amount: 0, refund_due_note: null, refund_done_amount: 90 });
    await expect(markRefundDone(String(p._id))).rejects.toThrow(/ไม่มียอดรอโอนคืน/);
  });
});
