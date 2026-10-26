import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import promotionModel from "@/models/promotionModel";
import promotionUsagesModel from "@/models/promotionUsagesModel";
import pointTransactionModel from "@/models/pointTransactionModel";
import customerNotificationModel from "@/models/customerNotificationModel";
import userCouponModel from "@/models/userCouponModel";
import * as couponService from "@/services/couponService";
import * as promotionService from "@/services/promotionService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { notifyCustomersOfNewCodeNow } from "@/services/couponNoticeService";
import { normalizePromoCode } from "@/lib/promoCode";
import { reviewBlockReason, REVIEW_BLOCK_MESSAGE } from "@/services/reviewService";
import { makeProduct, makeUser } from "./helpers";

/** คูปอง/โค้ดส่วนลด: ตัดช่องว่าง · โค้ดหน้าร้าน · เพดาน 0 = ไม่จำกัด · ขอบเขตสินค้าของคูปอง · แจ้งเตือนในเว็บ · โค้ดในพรีออเดอร์ */

const DAY = 24 * 60 * 60 * 1000;

async function customer() {
  const role = await roleModel.create({ role_name: `customer-${Date.now()}-${Math.random()}`, role_type: "customer" });
  return makeUser({ role_id: role._id });
}

async function promo(over: Record<string, unknown> = {}) {
  return promotionModel.create({
    promotion_code: `C${Math.floor(Math.random() * 1e7)}`,
    promotion_name: "ลด 50",
    discount_type: "Amount",
    discount_value: 50,
    created_by: (await makeUser())._id,
    start_date: new Date(Date.now() - DAY),
    end_date: new Date(Date.now() + 10 * DAY),
    ...over,
  });
}

const line = (product_id: string, line_total = 300) => ({ product_id, category_id: null, quantity: 1, line_total });

describe("โค้ดส่วนลด", () => {
  it("ตัดช่องว่างทุกตำแหน่ง + ตัวพิมพ์ใหญ่", async () => {
    expect(normalizePromoCode("  save 10\n")).toBe("SAVE10");
    const p = await promo({ promotion_code: "SAVE10" });
    const user = await customer();
    await expect(couponService.checkPromotionCode(" sa ve10 ", String(user._id))).resolves.toMatchObject({ promotion_code: "SAVE10" });
    const r = await promotionService.validateForOrder({
      code: "save 10", user_id: String(user._id), lines: [line(String(p._id))], subtotal: 300, delivery_fee: 0,
    });
    expect(r.discount_amount).toBe(50);
  });

  it("โค้ดหน้าร้านกรอกในเว็บ = 'ใช้ได้เฉพาะที่หน้าร้าน' แม้หมดอายุ/ปิด/เต็มแล้ว", async () => {
    const user = await customer();
    await promo({ promotion_code: "SHOPONLY", applicable_channels: ["instore"], end_date: new Date(Date.now() - DAY), start_date: new Date(Date.now() - 5 * DAY), is_active: false });
    const msg = "โค้ดนี้ใช้ได้เฉพาะที่หน้าร้านเท่านั้น";
    await expect(couponService.checkPromotionCode("shoponly", String(user._id))).rejects.toMatchObject({ status: 422, message: msg });
    await expect(
      promotionService.validateForOrder({ code: "SHOPONLY", user_id: String(user._id), lines: [], subtotal: 0, delivery_fee: 0, channel: "online" })
    ).rejects.toMatchObject({ message: msg });
  });

  it("usage_limit / max_user_per_user / max_discount_amount = 0 ถือว่าไม่จำกัด (เดิม 0 = ใช้ไม่ได้)", async () => {
    const user = await customer();
    const p = await promo({ discount_type: "Percentage", discount_value: 10, usage_limit: 0, max_user_per_user: 0, max_discount_amount: 0 });
    const r = await promotionService.validateForOrder({
      code: p.promotion_code, user_id: String(user._id), lines: [line("a".repeat(24), 1000)], subtotal: 1000, delivery_fee: 0,
    });
    expect(r.discount_amount).toBe(100);
  });

  it("ร้านสร้างโค้ดใหม่ → กระดิ่งในเว็บของลูกค้าพร้อมรหัส · โค้ดหน้าร้าน/แลกแต้มไม่แจ้ง · ลบโค้ด = ซ่อน", async () => {
    const a = await customer();
    const b = await customer();
    const staff = await makeUser();
    const created = await promotionService.createPromotion(
      {
        promotion_code: "new 50", promotion_name: "โค้ดใหม่", discount_type: "Amount", discount_value: 50,
        start_date: new Date(Date.now() - 1000), end_date: new Date(Date.now() + DAY),
      } as never,
      String(staff._id)
    );
    expect(created.promotion_code).toBe("NEW50");
    await new Promise((r) => setTimeout(r, 100)); // แจ้งเตือนทำงานเบื้องหลัง
    const notes = await customerNotificationModel.find({ ref_type: "promotion" }).lean<{ user_id: unknown; coupon_code: string }[]>();
    expect(notes.map((n) => String(n.user_id)).sort()).toEqual([String(a._id), String(b._id)].sort());
    expect(notes[0].coupon_code).toBe("NEW50");

    expect(await notifyCustomersOfNewCodeNow(await promo({ applicable_channels: ["instore"] }))).toBe(0);
    expect(await notifyCustomersOfNewCodeNow(await promo({ points_cost: 100 }))).toBe(0);

    await promotionService.deletePromotion(String(created._id));
    expect(await customerNotificationModel.countDocuments({ ref_type: "promotion", deleted_at: null })).toBe(0);
  });
});

describe("คูปองของฉัน", () => {
  it("แลกแล้วได้แจ้งเตือนพร้อมรหัส · คูปองของโปรเฉพาะสินค้า ใช้กับสินค้าอื่นไม่ได้ (เดิมลดทั้งตะกร้า)", async () => {
    const user = await customer();
    const uid = String(user._id);
    await pointTransactionModel.create({
      user_id: user._id, type: "earn", source: "welcome", points: 1000, remaining: 1000,
      expires_at: new Date(Date.now() + 365 * DAY), description: "ทดสอบ", dedupe_key: `t-${Math.random()}`,
    });
    const cake = await makeProduct();
    const bread = await makeProduct();
    const p = await promo({ points_cost: 100, applicable_products: [cake._id] });
    const coupon = await couponService.redeemCoupon(uid, String(p._id));
    const note = await customerNotificationModel.findOne({ user_id: user._id, ref_type: "coupon" }).lean<{ coupon_code: string }>();
    expect(note?.coupon_code).toBe(p.promotion_code);

    await expect(
      couponService.applyUserCoupon({
        userId: uid, userCouponId: String(coupon._id), lines: [line(String(bread._id))], subtotal: 300, delivery_fee: 0,
        refType: "order", refId: (await makeUser())._id,
      })
    ).rejects.toMatchObject({ status: 422 });
    const ok = await couponService.applyUserCoupon({
      userId: uid, userCouponId: String(coupon._id), lines: [line(String(cake._id)), line(String(bread._id))], subtotal: 600, delivery_fee: 0,
      refType: "order", refId: (await makeUser())._id,
    });
    expect(ok.discount_amount).toBe(50);
  });

  it("คูปองจากโปรที่มูลค่ามากกว่ายอด ยังใช้ได้ ลดไม่เกินยอด (กติกาห้ามเกินยอดใช้กับคูปองแลกแต้มเท่านั้น) · คูปองเก่าไม่มี source ก็เช่นกัน", async () => {
    const user = await customer();
    const uid = String(user._id);
    await pointTransactionModel.create({
      user_id: user._id, type: "earn", source: "welcome", points: 1000, remaining: 1000,
      expires_at: new Date(Date.now() + 365 * DAY), description: "ทดสอบ", dedupe_key: `t-${Math.random()}`,
    });
    const product = await makeProduct();
    const p = await promo({ points_cost: 100 });

    const fresh = await couponService.redeemCoupon(uid, String(p._id));
    const a = await couponService.applyUserCoupon({
      userId: uid, userCouponId: String(fresh._id), lines: [line(String(product._id), 30)], subtotal: 30, delivery_fee: 0,
      refType: "order", refId: (await makeUser())._id,
    });
    expect(a.discount_amount).toBe(30);

    // คูปองที่แลกก่อนมี field source (ข้อมูลเก่าใน DB)
    const legacy = await couponService.redeemCoupon(uid, String(p._id));
    await userCouponModel.collection.updateOne({ _id: legacy._id }, { $unset: { source: "" } });
    const b = await couponService.applyUserCoupon({
      userId: uid, userCouponId: String(legacy._id), lines: [line(String(product._id), 30)], subtotal: 30, delivery_fee: 0,
      refType: "order", refId: (await makeUser())._id,
    });
    expect(b.discount_amount).toBe(30);
  });
});

describe("โค้ดส่วนลดในพรีออเดอร์", () => {
  it("ใช้โค้ดได้ + บันทึกการใช้ · ใช้ครบโควตาแล้ว = พรีออเดอร์ไม่สำเร็จ", async () => {
    const user = await customer();
    const other = await customer();
    const p = await makeProduct({
      is_preorder: true, product_stock_quantity: null, product_price: 500,
      preorder_config: { min_order_qty: 1, max_order_qty: 50, lead_time_days: 1 },
    });
    const round = (await preorderRoundService.createRound(
      {
        round_name: `รอบโค้ด-${Date.now()}`, open_date: new Date(Date.now() - 1000), close_date: new Date(Date.now() + DAY),
        pickup_date: new Date(Date.now() + 5 * DAY), round_status: "open",
        items: [{ product_id: String(p._id), max_qty_total: 100 }],
      },
      String((await makeUser())._id)
    )) as { _id: unknown; items: Array<{ _id: unknown }> };
    const code = await promo({ promotion_code: "PRE50", usage_limit: 1 });
    const order = (uid: string) =>
      preorderService.createPreorder(
        uid,
        { round_id: String(round._id), order_type: "takeaway", items: [{ round_item_id: String(round.items[0]._id), quantity: 1 }], promotion_code: "pre 50" },
        { storefront: true }
      ) as Promise<{ _id: unknown; discount_amount: number; total_amount: number }>;

    const first = await order(String(user._id));
    expect(first).toMatchObject({ discount_amount: 50, total_amount: 450 });
    expect(await promotionUsagesModel.countDocuments({ promotion_id: code._id, preorder_id: first._id })).toBe(1);

    await expect(order(String(other._id))).rejects.toMatchObject({ status: 422 });
  });
});

describe("รีวิว: เหตุที่ยังรีวิวไม่ได้", () => {
  it("ยกเลิก → ยังไม่ชำระ → ยังไม่สำเร็จ (ข้อความตรงกับหน้าเว็บ)", () => {
    expect(reviewBlockReason({ order_status: "cancelled", payment_status: "paid" })).toBe("cancelled");
    expect(reviewBlockReason({ order_status: "completed", payment_status: "pending" })).toBe("unpaid");
    expect(reviewBlockReason({ order_status: "ready", payment_status: "paid" })).toBe("notCompleted");
    expect(reviewBlockReason({ order_status: "completed", payment_status: "paid" })).toBeNull();
    expect(REVIEW_BLOCK_MESSAGE.unpaid("คำสั่งซื้อ")).toBe("รีวิวได้หลังจากคำสั่งซื้อชำระเงินแล้ว");
  });
});
