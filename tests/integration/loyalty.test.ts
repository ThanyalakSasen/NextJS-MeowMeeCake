import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import productModel from "@/models/productModel";
import promotionModel from "@/models/promotionModel";
import promotionUsagesModel from "@/models/promotionUsagesModel";
import pointTransactionModel from "@/models/pointTransactionModel";
import userCouponModel from "@/models/userCouponModel";
import orderModel from "@/models/orderModel";
import productCategoryModel from "@/models/productCategoryModel";
import * as orderService from "@/services/orderService";
import * as pointsService from "@/services/pointsService";
import * as couponService from "@/services/couponService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { makeUser, makeProduct } from "./helpers";

/** ขั้น 6 — แต้มสะสม + คูปองส่วนตัว (customer-backend-merge.md §8.11) */

const DAY = 24 * 60 * 60 * 1000;

async function customer() {
  const role = await roleModel.create({ role_name: `customer-${Date.now()}-${Math.random()}`, role_type: "customer" });
  return makeUser({ role_id: role._id });
}

/** ให้แต้มตรง ๆ (ล็อตเดียว) */
async function give(userId: unknown, points: number, daysToExpire = 365) {
  return pointTransactionModel.create({
    user_id: userId, type: "earn", source: "welcome", points, remaining: points,
    expires_at: new Date(Date.now() + daysToExpire * DAY), description: "ทดสอบ", dedupe_key: `t-${Math.random()}`,
  });
}

async function pointsPromo(over: Record<string, unknown> = {}) {
  return promotionModel.create({
    promotion_code: `PTS${Math.floor(Math.random() * 1e6)}`, promotion_name: "ลด 50", discount_type: "Amount",
    discount_value: 50, points_cost: 200, created_by: (await makeUser())._id, start_date: new Date(Date.now() - DAY), end_date: new Date(Date.now() + 10 * DAY),
    ...over,
  });
}

const webOrder = (userId: string, productId: string, extra: Record<string, unknown> = {}) =>
  orderService.createOrder(userId, {
    order_type: "takeaway",
    items: [{ product_id: productId, quantity: 2 }],
    storefront: true,
    ...extra,
  }) as Promise<{ _id: unknown; order_no: string; subtotal: number; discount_amount: number; total_amount: number }>;

describe("กติกาแต้ม", () => {
  it("เพดาน 30% · ทีละ 10 · ขั้นต่ำ 100 แต้ม", () => {
    expect(pointsService.maxRedeemablePoints(99, 1000)).toBe(0);
    expect(pointsService.maxRedeemablePoints(5000, 70)).toBe(210); // 30% ของ 70 = 21 บาท = 210 แต้ม
    expect(pointsService.maxRedeemablePoints(155, 1000)).toBe(150);
    expect(pointsService.pointsEarnedFor(2499)).toBe(99);
    expect(() => pointsService.validateRedemption(15, 500, 1000)).toThrow(/ทีละ 10/);
  });
});

describe("ใช้แต้มตอนสั่งซื้อ + ยกเลิก/สำเร็จ", () => {
  it("ใช้ 300 แต้ม = ลด 30 บาท · ยกเลิก → คืนแต้มกลับล็อตเดิม · ออเดอร์สำเร็จได้แต้มตามยอดหลังส่วนลด", async () => {
    const user = await customer();
    const uid = String(user._id);
    await give(user._id, 100, 10); // ใกล้หมดอายุ — ใช้ก่อน
    await give(user._id, 400);
    const p = await makeProduct({ product_price: 250, product_stock_quantity: 10 });

    const o = await webOrder(uid, String(p._id), { points_to_redeem: 300 });
    expect(o.subtotal).toBe(500);
    expect(o.discount_amount).toBe(30);
    expect(o.total_amount).toBe(470);
    expect(await pointsService.getBalance(uid)).toBe(200);
    const nearLot = await pointTransactionModel.findOne({ user_id: user._id, points: 100 }).lean<{ remaining: number }>();
    expect(nearLot!.remaining).toBe(0); // FIFO ตามวันหมดอายุ

    await orderService.cancelOrderByCustomer(String(o._id), uid);
    expect(await pointsService.getBalance(uid)).toBe(500);

    const done = await webOrder(uid, String(p._id), { points_to_redeem: 100 });
    for (const st of ["confirmed", "preparing", "ready", "completed"] as const) {
      await orderService.updateOrderStatus(String(done._id), st);
    }
    // 500 − 10 = 490 → 19 แต้ม · ใช้ไป 100 → 400 + 19
    expect(await pointsService.getBalance(uid)).toBe(419);
    await orderService.updateOrderStatus(String(done._id), "completed"); // ซ้ำไม่ให้ซ้ำ
    expect(await pointsService.getBalance(uid)).toBe(419);
  });

  it("แต้มเกินเพดาน / ไม่พอ → 400 และไม่หักแต้ม ไม่ตัดสต็อก", async () => {
    const user = await customer();
    await give(user._id, 1000);
    const p = await makeProduct({ product_price: 100, product_stock_quantity: 5 });
    await expect(webOrder(String(user._id), String(p._id), { points_to_redeem: 700 })).rejects.toMatchObject({ status: 400 });
    expect(await pointsService.getBalance(String(user._id))).toBe(1000);
    expect((await productModel.findById(p._id).lean<{ product_stock_quantity: number }>())!.product_stock_quantity).toBe(5);
    expect(await orderModel.countDocuments({ user_id: user._id })).toBe(0);
  });

  it("พนักงาน/เจ้าของร้านไม่สะสมแต้ม", async () => {
    const staff = await makeUser();
    expect(await pointsService.awardWelcomeBonus(String(staff._id))).toBeNull();
  });
});

describe("คูปองส่วนตัว (แลกด้วยแต้ม)", () => {
  it("แลก → ใช้กับออเดอร์ + แต้มร่วมได้ · ใช้ซ้ำไม่ได้ · ยกเลิกออเดอร์ → คูปองกลับมาใช้ได้", async () => {
    const user = await customer();
    const uid = String(user._id);
    await give(user._id, 600);
    const promo = await pointsPromo();

    const coupon = (await couponService.redeemCoupon(uid, String(promo._id))) as { _id: unknown };
    expect(await pointsService.getBalance(uid)).toBe(400);
    const overview = await couponService.getCouponOverview(uid);
    expect(overview.coupons[0].state).toBe("available");

    const p = await makeProduct({ product_price: 250, product_stock_quantity: 10 });
    // โค้ดของโปรแลกแต้มกรอกตรง ๆ ไม่ได้ · ใช้คู่กับโค้ดไม่ได้
    await expect(webOrder(uid, String(p._id), { promotion_code: promo.promotion_code })).rejects.toMatchObject({ status: 422 });
    await expect(
      webOrder(uid, String(p._id), { user_coupon_id: String(coupon._id), promotion_code: "X" })
    ).rejects.toMatchObject({ status: 400 });

    // 500 − คูปอง 50 = 450 → เพดานแต้ม 30% = 135 บาท · ใช้ 100 แต้ม = 10 บาท
    const o = await webOrder(uid, String(p._id), { user_coupon_id: String(coupon._id), points_to_redeem: 100 });
    expect(o.discount_amount).toBe(60);
    expect(o.total_amount).toBe(440);
    const saved = await orderModel.findById(o._id).lean<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(saved).toMatchObject({ coupon_discount: 50, points_redeemed: 100, points_discount: 10 });
    expect(String(saved.promotion_id)).toBe(String(promo._id));
    expect((await promotionModel.findById(promo._id).lean<{ used_count: number }>())!.used_count).toBe(1);
    await expect(webOrder(uid, String(p._id), { user_coupon_id: String(coupon._id) })).rejects.toMatchObject({ status: 422 });

    await orderService.cancelOrderByCustomer(String(o._id), uid);
    expect((await userCouponModel.findById(coupon._id).lean<{ status: string }>())!.status).toBe("available");
    expect((await promotionModel.findById(promo._id).lean<{ used_count: number }>())!.used_count).toBe(0);
    expect(await promotionUsagesModel.countDocuments({ order_id: o._id, deleted_at: null })).toBe(0);
    expect(await pointsService.getBalance(uid)).toBe(400);
  });

  it("แต้มไม่พอ / เกินจำนวนต่อคน → แลกไม่ได้ · สร้างออเดอร์ไม่สำเร็จ → คืนคูปองและแต้ม", async () => {
    const user = await customer();
    const uid = String(user._id);
    const promo = await pointsPromo({ max_user_per_user: 1, min_order_amount: 1000 });
    await give(user._id, 150);
    await expect(couponService.redeemCoupon(uid, String(promo._id))).rejects.toMatchObject({ status: 400 });
    await give(user._id, 300);
    const coupon = (await couponService.redeemCoupon(uid, String(promo._id))) as { _id: unknown };
    await expect(couponService.redeemCoupon(uid, String(promo._id))).rejects.toMatchObject({ status: 400 });

    const p = await makeProduct({ product_price: 250, product_stock_quantity: 1 });
    // ยอดไม่ถึงขั้นต่ำของคูปอง → 422 · คูปองยังว่าง
    await expect(webOrder(uid, String(p._id), { user_coupon_id: String(coupon._id) })).rejects.toMatchObject({ status: 422 });
    expect((await userCouponModel.findById(coupon._id).lean<{ status: string }>())!.status).toBe("available");

    // สต็อกไม่พอหลังใช้แต้มแล้ว → saga คืนแต้ม
    const big = await makeProduct({ product_price: 1000, product_stock_quantity: 1 });
    const before = await pointsService.getBalance(uid);
    await expect(
      webOrder(uid, String(big._id), { user_coupon_id: String(coupon._id), points_to_redeem: 100 })
    ).rejects.toMatchObject({ status: 409 });
    expect(await pointsService.getBalance(uid)).toBe(before);
    expect((await userCouponModel.findById(coupon._id).lean<{ status: string }>())!.status).toBe("available");
  });
});

describe("เพดานแต้ม + คูปองส่งฟรี (Q-BE14)", () => {
  const address = {
    recipient_name: "ลูกค้า", recipient_phone: "0812345678", house_no: "1",
    sub_district: "ในเมือง", district: "เมือง", province: "กรุงเทพมหานคร", zip_code: "10100",
  };

  async function freeShippingCoupon(uid: string) {
    const promo = await pointsPromo({ discount_type: "FreeShipping", discount_value: 0 });
    return (await couponService.redeemCoupon(uid, String(promo._id))) as { _id: unknown };
  }

  it("ออเดอร์: ส่วนลดค่าส่งไม่ลดฐานคิดแต้ม → ใช้แต้มได้เต็ม 30% ของยอดสินค้า", async () => {
    const user = await customer();
    const uid = String(user._id);
    await give(user._id, 5000);
    const coupon = await freeShippingCoupon(uid);
    const cat = await productCategoryModel.create({ product_category_name: `ส่งทั่วประเทศ-${Math.random()}`, ships_nationwide: true });
    const p = await makeProduct({ product_price: 500, category_id: cat._id, product_stock_quantity: 10 });

    // ยอดสินค้า 1,000 · ค่าส่ง 100 (Zone D) → ส่งฟรี 100 · เพดานแต้ม 30% × 1,000 = 300 บาท = 3,000 แต้ม (เดิม 2,700)
    const o = (await orderService.createOrder(uid, {
      order_type: "delivery", delivery_address: address, storefront: true,
      items: [{ product_id: String(p._id), quantity: 2 }],
      user_coupon_id: String(coupon._id), points_to_redeem: 3000,
    })) as { _id: unknown; subtotal: number; delivery_fee: number; discount_amount: number; total_amount: number };
    expect(o).toMatchObject({ subtotal: 1000, delivery_fee: 100, discount_amount: 400, total_amount: 700 });
    expect(await orderModel.findById(o._id).lean()).toMatchObject({ coupon_discount: 100, points_redeemed: 3000, points_discount: 300 });
  });

  it("พรีออเดอร์: คูปองส่งฟรีไม่ลดฐานคิดแต้มเช่นกัน", async () => {
    const user = await customer();
    const uid = String(user._id);
    await give(user._id, 5000);
    const coupon = await freeShippingCoupon(uid);
    const p = await makeProduct({
      is_preorder: true, product_stock_quantity: null, product_price: 1000,
      preorder_config: { min_order_qty: 1, max_order_qty: 50, lead_time_days: 1 },
    });
    const round = (await preorderRoundService.createRound(
      {
        round_name: `รอบแต้ม-${Date.now()}`, open_date: new Date(Date.now() - 1000), close_date: new Date(Date.now() + DAY),
        pickup_date: new Date(Date.now() + 5 * DAY), round_status: "open",
        items: [{ product_id: String(p._id), max_qty_total: 100 }],
      },
      String((await makeUser())._id)
    )) as { _id: unknown; items: Array<{ _id: unknown }> };

    const pre = (await preorderService.createPreorder(
      uid,
      {
        round_id: String(round._id), order_type: "delivery", delivery_address: address,
        items: [{ round_item_id: String(round.items[0]._id), quantity: 1 }],
        user_coupon_id: String(coupon._id), points_to_redeem: 3000,
      },
      { storefront: true }
    )) as { subtotal: number; delivery_fee: number; discount_amount: number; total_amount: number };
    expect(pre).toMatchObject({ subtotal: 1000, delivery_fee: 100, discount_amount: 400, total_amount: 700 });
  });
});
