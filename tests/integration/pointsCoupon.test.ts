import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import pointTransactionModel from "@/models/pointTransactionModel";
import promotionUsagesModel from "@/models/promotionUsagesModel";
import * as couponService from "@/services/couponService";
import * as pointsService from "@/services/pointsService";
import { makeProduct, makeUser } from "./helpers";

/** แลกแต้มเป็นคูปองส่วนลดบาท (หน้าสมาชิก · POST /api/shop/points/convert) — 100 แต้ม = ฿10 · ขั้นต่ำ 100 · ทีละ 10 */

const DAY = 24 * 60 * 60 * 1000;

async function customerWith(points: number) {
  const role = await roleModel.create({ role_name: `customer-${Date.now()}-${Math.random()}`, role_type: "customer" });
  const user = await makeUser({ role_id: role._id });
  await pointTransactionModel.create({
    user_id: user._id, type: "earn", source: "welcome", points, remaining: points,
    expires_at: new Date(Date.now() + 365 * DAY), description: "ทดสอบ", dedupe_key: `t-${Math.random()}`,
  });
  return String(user._id);
}

describe("แลกแต้มเป็นคูปองส่วนลด", () => {
  it("150 แต้ม → คูปอง ฿15 · หักแต้ม · ใช้กับออเดอร์ได้โดยไม่บันทึกการใช้โปร", async () => {
    const uid = await customerWith(300);
    const coupon = await couponService.convertPointsToCoupon(uid, 150);
    expect(coupon).toMatchObject({ source: "points", promotion_id: null, discount_type: "Amount", discount_value: 15, points_spent: 150 });
    expect(await pointsService.getBalance(uid)).toBe(150);

    const product = await makeProduct();
    const applied = await couponService.applyUserCoupon({
      userId: uid,
      userCouponId: String(coupon._id),
      lines: [{ product_id: String(product._id), category_id: null, quantity: 1, line_total: 200 }],
      subtotal: 200,
      delivery_fee: 0,
      refType: "order",
      refId: (await makeUser())._id,
    });
    expect(applied.discount_amount).toBe(15);
    expect(await promotionUsagesModel.countDocuments({ user_id: uid })).toBe(0);
    await applied.undo();
  });

  it("คูปองมูลค่ามากกว่ายอดสินค้า → 422 · คูปองยังใช้ได้", async () => {
    const uid = await customerWith(500);
    const coupon = await couponService.convertPointsToCoupon(uid, 500);
    const product = await makeProduct();
    await expect(
      couponService.applyUserCoupon({
        userId: uid,
        userCouponId: String(coupon._id),
        lines: [{ product_id: String(product._id), category_id: null, quantity: 1, line_total: 30 }],
        subtotal: 30,
        delivery_fee: 0,
        refType: "order",
        refId: (await makeUser())._id,
      })
    ).rejects.toMatchObject({ status: 422 });
  });

  it("ต่ำกว่า 100 / ไม่ใช่ทีละ 10 / แต้มไม่พอ → 400 และแต้มไม่หาย", async () => {
    const uid = await customerWith(120);
    await expect(couponService.convertPointsToCoupon(uid, 90)).rejects.toMatchObject({ status: 400 });
    await expect(couponService.convertPointsToCoupon(uid, 105)).rejects.toMatchObject({ status: 400 });
    await expect(couponService.convertPointsToCoupon(uid, 200)).rejects.toMatchObject({ status: 400 });
    expect(await pointsService.getBalance(uid)).toBe(120);
  });
});
