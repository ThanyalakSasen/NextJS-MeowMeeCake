import { describe, it, expect } from "vitest";
import roleModel from "@/models/roleModel";
import promotionModel from "@/models/promotionModel";
import promotionUsagesModel from "@/models/promotionUsagesModel";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { makeUser, makeProduct } from "./helpers";

/** โค้ดส่วนลด (promotion_code) ในพรีออเดอร์ — พรีวิว + สั่งจริง + บันทึกการใช้ */

const DAY = 24 * 60 * 60 * 1000;

async function customer() {
  const role = await roleModel.create({ role_name: `customer-${Date.now()}-${Math.random()}`, role_type: "customer" });
  return String((await makeUser({ role_id: role._id }))._id);
}

async function promo(over: Record<string, unknown> = {}) {
  return promotionModel.create({
    promotion_code: `PRE${Math.floor(Math.random() * 1e6)}`, promotion_name: "ลด 50", discount_type: "Amount",
    discount_value: 50, created_by: (await makeUser())._id,
    start_date: new Date(Date.now() - DAY), end_date: new Date(Date.now() + 10 * DAY),
    ...over,
  });
}

async function round() {
  const p = await makeProduct({
    is_preorder: true, product_stock_quantity: null, product_price: 300,
    preorder_config: { min_order_qty: 1, max_order_qty: 50, lead_time_days: 1 },
  });
  return (await preorderRoundService.createRound(
    {
      round_name: `รอบโค้ด-${Date.now()}-${Math.random()}`, open_date: new Date(Date.now() - 1000), close_date: new Date(Date.now() + DAY),
      pickup_date: new Date(Date.now() + 5 * DAY), round_status: "open",
      items: [{ product_id: String(p._id), max_qty_total: 100 }],
    },
    String((await makeUser())._id)
  )) as { _id: unknown; items: Array<{ _id: unknown }> };
}

const input = (r: { _id: unknown; items: Array<{ _id: unknown }> }, extra: Record<string, unknown> = {}) => ({
  round_id: String(r._id),
  order_type: "takeaway" as const,
  items: [{ round_item_id: String(r.items[0]._id), quantity: 2 }],
  ...extra,
});

describe("โค้ดส่วนลดในพรีออเดอร์", () => {
  it("พรีวิวคิดส่วนลดจากราคาของรอบ โดยไม่สร้างเอกสาร/ไม่บันทึกการใช้", async () => {
    const uid = await customer();
    const pr = await promo();
    const r = await round();
    const preview = await preorderService.previewPreorderPromotion(uid, input(r, { promotion_code: pr.promotion_code.toLowerCase() }));
    expect(preview).toMatchObject({ promotion_code: pr.promotion_code, discount_amount: 50, subtotal: 600, delivery_fee: 0 });
    expect(await promotionUsagesModel.countDocuments({ promotion_id: pr._id })).toBe(0);
  });

  it("สั่งจริง: หักส่วนลด + ผูก promotion_id + บันทึกการใช้กับ preorder_id", async () => {
    const uid = await customer();
    const pr = await promo();
    const r = await round();
    const pre = (await preorderService.createPreorder(uid, input(r, { promotion_code: pr.promotion_code }), { storefront: true })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(pre).toMatchObject({ subtotal: 600, discount_amount: 50, total_amount: 550 });
    expect(String(pre.promotion_id)).toBe(String(pr._id));
    const usage = await promotionUsagesModel.findOne({ promotion_id: pr._id }).lean<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(String(usage.preorder_id)).toBe(String(pre._id));
  });

  it("โค้ดไม่ถูกต้อง = 404 · ใช้ร่วมกับคูปองของฉันไม่ได้ = 400", async () => {
    const uid = await customer();
    const r = await round();
    await expect(preorderService.previewPreorderPromotion(uid, input(r, { promotion_code: "NOPE-XYZ" }))).rejects.toMatchObject({ status: 404 });
    const pr = await promo();
    await expect(
      preorderService.createPreorder(uid, input(r, { promotion_code: pr.promotion_code, user_coupon_id: String(pr._id) }), { storefront: true })
    ).rejects.toMatchObject({ status: 400 });
  });
});
