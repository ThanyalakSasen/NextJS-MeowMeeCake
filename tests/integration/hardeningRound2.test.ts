import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import roleModel from "@/models/roleModel";
import userLogModel from "@/models/userLogModel";
import productModel from "@/models/productModel";
import orderModel from "@/models/orderModel";
import paymentModel from "@/models/paymentModel";
import notificationModel from "@/models/notificationModel";
import promotionModel from "@/models/promotionModel";
import pointTransactionModel from "@/models/pointTransactionModel";
import userCouponModel from "@/models/userCouponModel";
import preorderItemModel from "@/models/preorderItemModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import { USER_HEADER, type SessionUser } from "@/lib/session";
import { POST as userLogPOST } from "@/app/api/admin/user-logs/route";
import * as orderService from "@/services/orderService";
import * as paymentService from "@/services/paymentService";
import * as cartService from "@/services/cartService";
import * as couponService from "@/services/couponService";
import * as pointsService from "@/services/pointsService";
import * as preorderService from "@/services/preorderService";
import * as preorderRoundService from "@/services/preorderRoundService";
import { assertOwnReviewMedia } from "@/services/reviewMediaService";
import { warnSlipOnCancelledPreorder } from "@/services/preorderRoundLifecycleService";
import { makeUser, makeProduct, makePreorder } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const SLIP = (n: number) => `/api/files/slips/17000000000${String(n).padStart(2, "0")}-aaaaaaaaaaaa.jpg`;

async function userWithRole(roleType: "owner" | "customer") {
  const role = await roleModel.create({ role_name: `${roleType}-${Math.random()}`, role_type: roleType });
  return makeUser({ role_id: role._id });
}

async function givePoints(userId: unknown, points: number) {
  return pointTransactionModel.create({
    user_id: userId, type: "earn", source: "welcome", points, remaining: points,
    expires_at: new Date(Date.now() + 365 * DAY), description: "ทดสอบ", dedupe_key: `t-${Math.random()}`,
  });
}

describe("1. audit log — เขียนในชื่อคนอื่นไม่ได้", () => {
  it("POST /api/admin/user-logs เมิน user_id/ip_address ใน body → ใช้ผู้ล็อกอิน", async () => {
    const owner = await userWithRole("owner");
    const victim = await makeUser();
    const session: SessionUser = {
      user_id: String(owner._id), role_id: String(owner.role_id), role_type: "owner",
      email: owner.email, source: "jwt", auth_time: Date.now(),
    };
    const res = await userLogPOST(
      new NextRequest("http://localhost:3000/api/admin/user-logs", {
        method: "POST",
        headers: { [USER_HEADER]: JSON.stringify(session), "content-type": "application/json", "x-real-ip": "10.0.0.9" },
        body: JSON.stringify({ user_id: String(victim._id), ip_address: "1.2.3.4", action: "ลบข้อมูล", action_type: "DELETE" }),
      })
    );
    expect(res.status).toBe(201);
    const logDoc = await userLogModel.findOne({ action: "ลบข้อมูล" }).lean<{ user_id: unknown; ip_address: string }>();
    expect(String(logDoc!.user_id)).toBe(String(owner._id));
    expect(logDoc!.ip_address).toBe("10.0.0.9");
  });
});

describe("2. รูป/วิดีโอรีวิว — ต้องเป็นไฟล์ของผู้รีวิวที่อัปโหลดผ่านระบบ", () => {
  const uid = "6a0000000000000000000001";
  const own = `/uploads/reviews/${uid}-1700000000000-abcdef.png`;

  it("ไฟล์ของตัวเองผ่าน · URL ภายนอก / ไฟล์คนอื่น / ชนิดไม่ตรง → 400", () => {
    expect(() => assertOwnReviewMedia(uid, { image: [own], video: `/uploads/reviews/${uid}-1-aa.mp4` })).not.toThrow();
    for (const bad of [
      { image: ["https://evil.example/pixel.png"] },
      { image: ["/uploads/reviews/6a0000000000000000000002-1-aa.png"] },
      { image: ["/uploads/products/x.png"] },
      { image: [`/uploads/reviews/${uid}-1-aa.mp4`] }, // วิดีโอใส่ในช่องรูป
      { video: `/uploads/reviews/${uid}-1-aa.png` },
      { image: ["x"] },
    ]) {
      expect(() => assertOwnReviewMedia(uid, bad)).toThrow(/อัปโหลดผ่าน/);
    }
  });

  it("แก้รีวิว: ไฟล์ที่ติดรีวิวอยู่แล้ว (รีวิวเก่าระบบเดิม) คงไว้ได้", () => {
    const legacy = "https://old-backend.example/review/1.jpg";
    expect(() => assertOwnReviewMedia(uid, { image: [legacy, own] }, [legacy])).not.toThrow();
  });
});

describe("3. หมดเวลาชำระชนกับการแนบสลิป", () => {
  async function expiredOrderWithSlip(stock = 10) {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 100, product_stock_quantity: stock });
    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway", storefront: true, items: [{ product_id: String(p._id), quantity: 2 }],
    });
    // cron ยกเลิกไปแล้ว แล้วสลิปเพิ่งบันทึกลง DB (ลำดับที่เดิมทำให้ออเดอร์ค้าง "ยกเลิก + มีสลิป")
    await orderService.updateOrderStatus(String(order._id), "cancelled", { cancelled_reason: orderService.PAYMENT_EXPIRED_REASON });
    await paymentModel.create({ user_id: user._id, order_id: order._id, amount: 200, status: "pending", slip_image_url: SLIP(1) });
    return { order, product: p };
  }

  it("ออเดอร์ถูกยกเลิกทั้งที่มีสลิปรอตรวจ → เปิดกลับ + ตัดสต็อกใหม่", async () => {
    const { order, product } = await expiredOrderWithSlip();
    expect((await productModel.findById(product._id).lean())!.product_stock_quantity).toBe(10);

    expect(await orderService.reconcileExpiredWithSlip(String(order._id))).toBe(true);
    expect((await orderModel.findById(order._id).lean<{ order_status: string }>())!.order_status).toBe("pending");
    expect((await productModel.findById(product._id).lean())!.product_stock_quantity).toBe(8);
  });

  it("เปิดกลับไม่ได้ (ของหมด) → คงยกเลิก + แจ้งร้านให้ตรวจสลิป", async () => {
    const { order, product } = await expiredOrderWithSlip();
    await productModel.updateOne({ _id: product._id }, { $set: { product_stock_quantity: 0 } });

    expect(await orderService.reconcileExpiredWithSlip(String(order._id))).toBe(false);
    expect((await orderModel.findById(order._id).lean<{ order_status: string }>())!.order_status).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 50)); // แจ้งเตือนเป็น fire-and-forget
    expect(await notificationModel.exists({ title: new RegExp(`สลิปเข้ามาหลังออเดอร์ ${order.order_no}`) })).toBeTruthy();
  });

  it("พรีออเดอร์ที่ถูกยกเลิกแล้ว: แนบสลิป → 409 · ถ้าสลิปเข้ามาก่อนยกเลิกพอดี → แจ้งร้าน", async () => {
    const user = await makeUser();
    const pre = await makePreorder(String(user._id), { order_status: "cancelled" });
    const pay = await paymentModel.create({ user_id: user._id, preorder_id: pre._id, amount: 100, status: "failed" });
    await expect(paymentService.submitSlip(String(pay._id), { slip_image_url: SLIP(2) })).rejects.toMatchObject({ status: 409 });

    await paymentModel.updateOne({ _id: pay._id }, { $set: { status: "pending", slip_image_url: SLIP(2) } });
    expect(await warnSlipOnCancelledPreorder(String(pre._id))).toBe(true);
  });
});

describe("4. ส่งคำขอพร้อมกันแล้วเกินลิมิต", () => {
  it("แอดมิน 2 คนอนุมัติสลิปเดียวกันพร้อมกัน → สำเร็จครั้งเดียว", async () => {
    const user = await makeUser();
    const [a1, a2] = [await makeUser(), await makeUser()];
    const pre = await makePreorder(String(user._id), { total_amount: 100 });
    const pay = await paymentService.createPayment({ user_id: String(user._id), preorder_id: String(pre._id), amount: 100 });

    const results = await Promise.allSettled([
      paymentService.verifyPayment(String(pay._id), { verified_by: String(a1._id), approved: true }),
      paymentService.verifyPayment(String(pay._id), { verified_by: String(a2._id), approved: true }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  });

  it("แลกคูปอง (จำกัด 1 ใบ/คน) พร้อมกัน 3 คำขอ → ไม่เกิน 1 ใบ · แต้มหักเท่ากับคูปองที่ได้จริง", async () => {
    const user = await userWithRole("customer");
    await givePoints(user._id, 1000);
    const promo = await promotionModel.create({
      promotion_code: `PTS${Math.floor(Math.random() * 1e6)}`, promotion_name: "ลด 50", discount_type: "Amount",
      discount_value: 50, points_cost: 200, max_user_per_user: 1, created_by: user._id,
      start_date: new Date(Date.now() - DAY), end_date: new Date(Date.now() + 10 * DAY),
    });

    await Promise.allSettled([1, 2, 3].map(() => couponService.redeemCoupon(String(user._id), String(promo._id))));
    const coupons = await userCouponModel.countDocuments({ user_id: user._id, promotion_id: promo._id });
    expect(coupons).toBeLessThanOrEqual(1);
    expect(await pointsService.getBalance(String(user._id))).toBe(1000 - 200 * coupons); // ใบที่ถูกลบได้แต้มคืน

    // กดใหม่ทีละครั้ง: ได้ครบสิทธิ์ แล้วครั้งถัดไปโดนปฏิเสธ
    if (coupons === 0) await couponService.redeemCoupon(String(user._id), String(promo._id));
    await expect(couponService.redeemCoupon(String(user._id), String(promo._id))).rejects.toMatchObject({ status: 400 });
    expect(await userCouponModel.countDocuments({ user_id: user._id, promotion_id: promo._id })).toBe(1);
    expect(await pointsService.getBalance(String(user._id))).toBe(800);
  });

  it("พรีออเดอร์ (สูงสุด 3 ชิ้น/คน/รอบ) สั่งพร้อมกัน 2 ใบใบละ 2 → รวมไม่เกิน 3 · โควตาตรงกับของที่จองจริง", async () => {
    const user = await makeUser();
    const admin = await makeUser();
    const p = await makeProduct({
      is_preorder: true, product_stock_quantity: null, product_price: 100,
      preorder_config: { min_order_qty: 1, max_order_qty: 3, lead_time_days: 1 },
    });
    const close = Date.now() + DAY;
    const round = (await preorderRoundService.createRound(
      {
        round_name: `รอบ-${Math.random()}`, open_date: new Date(Date.now() - 1000), close_date: new Date(close),
        pickup_date: new Date(close + 2 * DAY), items: [{ product_id: String(p._id), max_qty_total: 50 }],
      },
      String(admin._id)
    )) as { _id: unknown; items: Array<{ _id: unknown }> };
    const roundItemId = String(round.items[0]._id);

    await Promise.allSettled(
      [1, 2].map(() =>
        preorderService.createPreorder(String(user._id), {
          round_id: String(round._id), order_type: "takeaway", items: [{ round_item_id: roundItemId, quantity: 2 }],
        })
      )
    );
    const items = await preorderItemModel.find({ round_item_id: roundItemId, deleted_at: null }).lean<Array<{ quantity: number }>>();
    const ordered = items.reduce((s, it) => s + it.quantity, 0);
    expect(ordered).toBeLessThanOrEqual(3);
    expect((await preorderRoundItemModel.findById(roundItemId).lean())!.current_qty).toBe(ordered);
  });
});

describe("5. สินค้าในตะกร้าถูกลบไปแล้ว", () => {
  it("ตะกร้าบอก is_available:false · สั่งซื้อได้ 400 พร้อมรายการที่ต้องนำออก", async () => {
    const user = await makeUser();
    const uid = String(user._id);
    const ok = await makeProduct({ product_price: 50, product_stock_quantity: 10 });
    const gone = await makeProduct({ product_price: 80, product_stock_quantity: 10 });
    await cartService.addItem(uid, { product_id: String(ok._id), quantity: 1 });
    const goneItem = await cartService.addItem(uid, { product_id: String(gone._id), quantity: 1 });
    await productModel.updateOne({ _id: gone._id }, { $set: { deleted_at: new Date() } });

    const detail = await cartService.getCartDetail(uid);
    expect(detail.summary.unavailable_count).toBe(1);
    expect(detail.items.find((it: any) => String(it._id) === String(goneItem._id))).toMatchObject({ is_available: false }); // eslint-disable-line @typescript-eslint/no-explicit-any

    await expect(
      orderService.createOrderFromCart(uid, { order_type: "takeaway", storefront: true })
    ).rejects.toMatchObject({
      status: 400,
      details: { unavailable_items: [expect.objectContaining({ cart_item_id: String(goneItem._id) })] },
    });
    expect((await productModel.findById(ok._id).lean())!.product_stock_quantity).toBe(10); // ไม่ตัดสต็อก
  });
});

describe("6. แต้มจากการแชร์ — จำกัดต่อวัน", () => {
  const limit = pointsService.POINT_RULES.SHARE_DAILY_LIMIT;

  it("แชร์ทีละสินค้า: ได้แต้มครบเพดานแล้วหยุด", async () => {
    const user = await userWithRole("customer");
    const awarded: number[] = [];
    for (let i = 0; i < limit + 2; i++) awarded.push((await pointsService.awardShare(String(user._id), await makeProduct())).awarded);
    expect(awarded.filter((a) => a > 0)).toHaveLength(limit);
    expect(await pointsService.awardShare(String(user._id), await makeProduct())).toEqual({ awarded: 0, daily_limit_reached: true });
  });

  it("ยิงพร้อมกันหลายสินค้า: ไม่เกินเพดาน · คำตอบตรงกับแต้มที่ได้จริง", async () => {
    const user = await userWithRole("customer");
    const products = await Promise.all([1, 2, 3, 4, 5, 6].map(() => makeProduct()));
    const results = await Promise.all(products.map((p) => pointsService.awardShare(String(user._id), p)));
    const lots = await pointTransactionModel.countDocuments({ user_id: user._id, source: "share" });
    expect(lots).toBeLessThanOrEqual(limit);
    expect(results.filter((r) => r.awarded > 0)).toHaveLength(lots);
  });
});
