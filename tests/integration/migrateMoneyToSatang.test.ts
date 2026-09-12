import { describe, it, expect } from "vitest";
import orderModel from "@/models/orderModel";
import orderItemModel from "@/models/orderItemModel";
import preorderModel from "@/models/preorderModel";
import preorderItemModel from "@/models/preorderItemModel";
import paymentModel from "@/models/paymentModel";
import promotionUsagesModel from "@/models/promotionUsagesModel";
import mongoose from "mongoose";
import { runMigration } from "../../scripts/migrate-money-to-satang";
import { makeUser, makeProduct, makePreorder } from "./helpers";

/**
 * BACKLOG §3.11 — scripts/migrate-money-to-satang.ts คูณข้อมูลเงินเดิม (บาท) ×100 ครั้งเดียวตอน
 * deploy จริง เทสนี้จำลองเอกสาร "แบบเก่า" (สร้างตรงผ่าน model ข้าม service ที่แปลงให้แล้ว) แล้วยืนยัน
 * ว่า migration แปลงถูกทุก field รวม nested array (selected_options[].extra_price) + กันรันซ้ำ
 */
describe("scripts/migrate-money-to-satang", () => {
  it("คูณ field เงินทุกตัว ×100 ให้ทุก collection รวม nested selected_options[].extra_price", async () => {
    const user = await makeUser();
    const product = await makeProduct();

    const order = await orderModel.create({
      order_no: `OP-TEST-${Date.now()}`,
      user_id: user._id,
      order_type: "takeaway",
      subtotal: 100,
      discount_amount: 10,
      delivery_fee: 40,
      total_amount: 130,
    });
    const orderItem = await orderItemModel.create({
      order_id: order._id,
      product_id: product._id,
      product_snapshot: { product_name_th: "x", product_name_eng: "x" },
      selected_options: [{ option_name: "เพิ่มไข่", extra_price: 5, text_value: null }],
      quantity: 2,
      unit_price: 50,
      total_price: 100,
      cost_per_unit: 20, // ต้อง "ไม่ถูกแตะ" — ยังเป็นบาทเหมือนเดิม
    });

    const preorder = await makePreorder(String(user._id), {
      subtotal: 200,
      discount_amount: 0,
      delivery_fee: 0,
      total_amount: 200,
    });
    const preorderItem = await preorderItemModel.create({
      preorder_id: preorder._id,
      round_item_id: new mongoose.Types.ObjectId(),
      product_id: product._id,
      product_snapshot: { product_name_th: "x", product_name_eng: "x" },
      pickup_date: new Date(),
      quantity: 1,
      unit_price: 200,
      total_price: 200,
      cost_per_unit: 80, // ต้อง "ไม่ถูกแตะ" เช่นกัน
    });

    const payment = await paymentModel.create({
      order_id: order._id,
      user_id: user._id,
      amount: 130,
      status: "pending",
    });

    const usage = await promotionUsagesModel.create({
      promotion_id: new mongoose.Types.ObjectId(),
      user_id: user._id,
      order_id: order._id,
      discount_applied: 10,
    });

    const summary = await runMigration();
    expect(summary).toMatchObject({
      orders: 1,
      order_items: 1,
      preorders: 1,
      preorder_items: 1,
      payments: 1,
      promotion_usages: 1,
    });

    const rOrder = await orderModel
      .findById(order._id)
      .lean<{ subtotal: number; discount_amount: number; delivery_fee: number; total_amount: number }>();
    expect(rOrder!.subtotal).toBe(10000);
    expect(rOrder!.discount_amount).toBe(1000);
    expect(rOrder!.delivery_fee).toBe(4000);
    expect(rOrder!.total_amount).toBe(13000);

    const rItem = await orderItemModel.findById(orderItem._id).lean<{
      unit_price: number;
      total_price: number;
      cost_per_unit: number;
      selected_options: { extra_price: number }[];
    }>();
    expect(rItem!.unit_price).toBe(5000);
    expect(rItem!.total_price).toBe(10000);
    expect(rItem!.selected_options[0].extra_price).toBe(500);
    expect(rItem!.cost_per_unit).toBe(20); // ยืนยันว่าไม่ถูกแตะ (ยังเป็นบาท)

    const rPreorder = await preorderModel
      .findById(preorder._id)
      .lean<{ subtotal: number; total_amount: number }>();
    expect(rPreorder!.subtotal).toBe(20000);
    expect(rPreorder!.total_amount).toBe(20000);

    const rPreorderItem = await preorderItemModel
      .findById(preorderItem._id)
      .lean<{ unit_price: number; total_price: number; cost_per_unit: number }>();
    expect(rPreorderItem!.unit_price).toBe(20000);
    expect(rPreorderItem!.total_price).toBe(20000);
    expect(rPreorderItem!.cost_per_unit).toBe(80); // ยืนยันว่าไม่ถูกแตะ

    const rPayment = await paymentModel.findById(payment._id).lean<{ amount: number }>();
    expect(rPayment!.amount).toBe(13000);

    const rUsage = await promotionUsagesModel
      .findById(usage._id)
      .lean<{ discount_applied: number }>();
    expect(rUsage!.discount_applied).toBe(1000);
  });

  it("กันรันซ้ำ — รันครั้งที่สองต้องไม่คูณ ×100 ซ้ำอีกรอบ", async () => {
    const user = await makeUser();
    const order = await orderModel.create({
      order_no: `OP-TEST-${Date.now()}`,
      user_id: user._id,
      order_type: "takeaway",
      subtotal: 100,
      total_amount: 100,
    });

    async function currentSubtotal(): Promise<number> {
      const doc = await orderModel.findById(order._id).lean<{ subtotal: number }>();
      return doc!.subtotal;
    }

    const first = await runMigration();
    expect(first).not.toBeNull();
    expect(await currentSubtotal()).toBe(10000);

    const second = await runMigration();
    expect(second).toBeNull(); // ข้ามเพราะมี marker แล้ว
    expect(await currentSubtotal()).toBe(10000); // ไม่ถูกคูณซ้ำ
  });
});
