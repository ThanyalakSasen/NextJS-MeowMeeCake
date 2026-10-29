import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import promotionModel from "@/models/promotionModel";
import promotionUsagesModel from "@/models/promotionUsagesModel";
import orderModel from "@/models/orderModel";
import * as orderService from "@/services/orderService";
import * as promotionService from "@/services/promotionService";
import { isHttpError } from "@/lib/httpError";
import { GUEST_CUSTOMER_EMAIL } from "@/lib/posGuest";
import { makeUser, makeProduct } from "./helpers";

// สร้างตรงผ่าน model — discount_value ตอน "Amount" เป็นบาท (เหมือน cancelOrder.test.ts)
async function makePromo(over: Record<string, unknown> = {}) {
  return promotionModel.create({
    promotion_code: "S" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    promotion_name: "stack test",
    discount_type: "Amount",
    discount_value: 20,
    start_date: new Date(Date.now() - 86_400_000),
    end_date: new Date(Date.now() + 86_400_000),
    created_by: new mongoose.Types.ObjectId(),
    ...over,
  });
}

const is422 = (e: unknown) => isHttpError(e) && e.status === 422;

async function posOrder(userId: string, productId: string, extra: Record<string, unknown>) {
  return orderService.createOrder(userId, {
    order_type: "takeaway",
    channel: "instore",
    items: [{ product_id: productId, quantity: 2 }],
    ...extra,
  });
}

describe("POS ซ้อนโปร (promotion_ids) + โปรเฉพาะสมาชิก (audience)", () => {
  it("โปร stackable 2 ตัว → ลดรวม บันทึก promotion_ids + usage ครบทั้ง 2", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100 });
    const a = await makePromo({ stackable: true, discount_value: 20 });
    const b = await makePromo({ stackable: true, discount_type: "Percentage", discount_value: 10 });

    const order = await posOrder(String(user._id), String(p._id), {
      promotion_ids: [String(a._id), String(b._id)],
    });

    expect(order.subtotal).toBe(200);
    expect(order.discount_amount).toBe(40); // 20 + 10% ของ 200
    expect(order.total_amount).toBe(160);
    const saved = await orderModel.findById(order._id).lean<{ promotion_id: unknown; promotion_ids: unknown[] }>();
    expect(saved!.promotion_ids.map(String)).toEqual([String(a._id), String(b._id)]);
    expect(String(saved!.promotion_id)).toBe(String(a._id));
    expect(await promotionUsagesModel.countDocuments({ order_id: order._id })).toBe(2);
  });

  it("มีโปรที่ไม่ได้ตั้ง stackable → 422 ไม่สร้างออเดอร์", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100 });
    const a = await makePromo({ stackable: true });
    const b = await makePromo({ stackable: false });

    await expect(
      posOrder(String(user._id), String(p._id), { promotion_ids: [String(a._id), String(b._id)] })
    ).rejects.toSatisfy(is422);
    expect(await orderModel.countDocuments({ user_id: user._id })).toBe(0);
  });

  it("ส่วนลดรวมเกินยอดบิล → 400 ไม่สร้างออเดอร์ ไม่กินสิทธิ์โปร", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100 });
    const a = await makePromo({ stackable: true, discount_value: 150 });
    const b = await makePromo({ stackable: true, discount_value: 150 });

    await expect(
      posOrder(String(user._id), String(p._id), { promotion_ids: [String(a._id), String(b._id)] })
    ).rejects.toSatisfy((e: unknown) => isHttpError(e) && e.status === 400);
    expect(await orderModel.countDocuments({ user_id: user._id })).toBe(0);
    expect((await promotionModel.findById(a._id).lean<{ used_count: number }>())!.used_count).toBe(0);
  });

  it("stackable_with: ซ้อนได้เมื่อทั้งสองฝั่งยอมกัน · ว่าง = ยอมทุกโปรที่ stackable", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100 });
    const a = await makePromo({ stackable: true, discount_value: 10 });
    const b = await makePromo({ stackable: true, discount_value: 10 });
    const c = await makePromo({ stackable: true, discount_value: 10 });
    // a ร่วมได้เฉพาะ b · b/c ว่าง (ยอมทุกตัว)
    await promotionModel.updateOne({ _id: a._id }, { $set: { stackable_with: [b._id] } });

    const ok = await posOrder(String(user._id), String(p._id), { promotion_ids: [String(a._id), String(b._id)] });
    expect(ok.discount_amount).toBe(20);
    // a ไม่ได้เลือก c → c ยอมก็ซ้อนไม่ได้
    await expect(
      posOrder(String(user._id), String(p._id), { promotion_ids: [String(c._id), String(a._id)] })
    ).rejects.toSatisfy(is422);
    // b ร่วมได้เฉพาะ c → a+b ไม่ได้แล้วแม้ a เลือก b ไว้
    await promotionModel.updateOne({ _id: b._id }, { $set: { stackable_with: [c._id] } });
    await expect(
      posOrder(String(user._id), String(p._id), { promotion_ids: [String(a._id), String(b._id)] })
    ).rejects.toSatisfy(is422);
    expect(await orderModel.countDocuments({ user_id: user._id })).toBe(1);
  });

  it("แก้โปร: stackable_with ตัดซ้ำ/ตัดตัวเอง · ปิด stackable = ล้างรายการ", async () => {
    const a = await makePromo({ stackable: true });
    const b = await makePromo({ stackable: true });
    const id = String(a._id);

    const updated = await promotionService.updatePromotion(id, { stackable_with: [String(b._id), String(b._id), id] });
    expect((updated.stackable_with as unknown[]).map(String)).toEqual([String(b._id)]);
    const off = await promotionService.updatePromotion(id, { stackable: false });
    expect(off.stackable_with).toEqual([]);
  });

  it("โปรเฉพาะสมาชิก: บัญชีลูกค้าทั่วไปของ POS ใช้ไม่ได้ · สมาชิกใช้ได้", async () => {
    const guest =
      (await mongoose.model("Users").findOne({ email: GUEST_CUSTOMER_EMAIL })) ??
      (await makeUser({ email: GUEST_CUSTOMER_EMAIL }));
    const member = await makeUser();
    const p = await makeProduct({ product_price: 100 });
    const promo = await makePromo({ audience: "members" });

    await expect(
      posOrder(String(guest._id), String(p._id), { promotion_id: String(promo._id) })
    ).rejects.toSatisfy(is422);

    const order = await posOrder(String(member._id), String(p._id), { promotion_id: String(promo._id) });
    expect(order.discount_amount).toBe(20);
  });
});
