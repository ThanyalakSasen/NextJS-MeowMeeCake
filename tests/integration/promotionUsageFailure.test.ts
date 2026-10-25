import { describe, it, expect, vi, afterEach } from "vitest";
import mongoose from "mongoose";
import roleModel from "@/models/roleModel";
import productModel from "@/models/productModel";
import orderModel from "@/models/orderModel";
import preorderModel from "@/models/preorderModel";
import promotionModel from "@/models/promotionModel";
import promotionUsagesModel from "@/models/promotionUsagesModel";
import * as orderService from "@/services/orderService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { makeUser, makeProduct } from "./helpers";

/**
 * บันทึกการใช้โปรโมชันไม่สำเร็จ (DB สะดุด · โปรถูกลบระหว่างสั่ง) → ทั้งเอกสารต้องล้ม
 * เดิม error ที่ไม่ใช่ 422 ถูกกลืน → ได้ส่วนลดแต่ไม่นับการใช้ → ข้าม usage_limit / ต่อคนได้
 */

const DAY = 24 * 60 * 60 * 1000;

async function makePromo(over: Record<string, unknown> = {}) {
  return promotionModel.create({
    promotion_code: "F" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    promotion_name: "usage failure test",
    discount_type: "Amount",
    discount_value: 20,
    usage_limit: 1,
    start_date: new Date(Date.now() - DAY),
    end_date: new Date(Date.now() + DAY),
    created_by: new mongoose.Types.ObjectId(),
    ...over,
  });
}

/** ให้การสร้างบันทึกการใช้ล้มครั้งถัดไป (แทน DB สะดุดหลังผ่านการตรวจโค้ดแล้ว) */
function failNextUsageRecord() {
  vi.spyOn(promotionUsagesModel, "create").mockRejectedValueOnce(new Error("db hiccup") as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("บันทึกการใช้โปรโมชันล้ม → ล้มทั้งเอกสาร (ไม่เก็บส่วนลดไว้โดยไม่นับการใช้)", () => {
  it("ออเดอร์: ไม่สร้างออเดอร์ · คืนสต็อก · used_count ไม่เพิ่ม · สั่งใหม่ได้", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 200, product_stock_quantity: 5 });
    const promo = await makePromo();
    const input = { order_type: "takeaway" as const, promotion_code: promo.promotion_code, items: [{ product_id: String(p._id), quantity: 1 }] };

    failNextUsageRecord();
    await expect(orderService.createOrder(String(user._id), input)).rejects.toThrow();

    expect(await orderModel.countDocuments({ user_id: user._id })).toBe(0);
    expect((await productModel.findById(p._id).lean<{ product_stock_quantity: number }>())!.product_stock_quantity).toBe(5);
    expect((await promotionModel.findById(promo._id).lean<{ used_count?: number }>())!.used_count ?? 0).toBe(0);
    expect(await promotionUsagesModel.countDocuments({ promotion_id: promo._id })).toBe(0);

    // ลูกค้าสั่งใหม่ได้ — ได้ส่วนลดและนับการใช้ตามปกติ
    const order = await orderService.createOrder(String(user._id), input);
    expect(order.discount_amount).toBe(20);
    expect((await promotionModel.findById(promo._id).lean<{ used_count: number }>())!.used_count).toBe(1);
  });

  it("ออเดอร์: โปรถูกลบระหว่างสั่ง (404 จาก recordUsage) → ล้มทั้งออเดอร์", async () => {
    const user = await makeUser();
    const p = await makeProduct({ product_price: 200, product_stock_quantity: 5 });
    const promo = await makePromo();

    // ลบโปรทันทีหลังตรวจโค้ดผ่าน — ตอน recordUsage จองสิทธิ์จะหาโปรไม่เจอ (ลบเสร็จก่อนค่อยจอง — ไม่ขึ้นกับจังหวะเวลา)
    const realFind = promotionModel.findOneAndUpdate.bind(promotionModel);
    vi.spyOn(promotionModel, "findOneAndUpdate").mockImplementationOnce(((...args: Parameters<typeof realFind>) => ({
      lean: async () => {
        await promotionModel.updateOne({ _id: promo._id }, { $set: { deleted_at: new Date() } });
        return realFind(...args).lean();
      },
    })) as never);

    await expect(
      orderService.createOrder(String(user._id), {
        order_type: "takeaway",
        promotion_code: promo.promotion_code,
        items: [{ product_id: String(p._id), quantity: 1 }],
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(await orderModel.countDocuments({ user_id: user._id })).toBe(0);
    expect((await productModel.findById(p._id).lean<{ product_stock_quantity: number }>())!.product_stock_quantity).toBe(5);
  });

  it("พรีออเดอร์: ไม่สร้างพรีออเดอร์ · คืนโควตารอบ · used_count ไม่เพิ่ม", async () => {
    const role = await roleModel.create({ role_name: `customer-${Date.now()}-${Math.random()}`, role_type: "customer" });
    const uid = String((await makeUser({ role_id: role._id }))._id);
    const promo = await makePromo();
    const product = await makeProduct({
      is_preorder: true, product_stock_quantity: null, product_price: 300,
      preorder_config: { min_order_qty: 1, max_order_qty: 50, lead_time_days: 1 },
    });
    const round = (await preorderRoundService.createRound(
      {
        round_name: `รอบล้ม-${Date.now()}-${Math.random()}`, open_date: new Date(Date.now() - 1000), close_date: new Date(Date.now() + DAY),
        pickup_date: new Date(Date.now() + 5 * DAY), round_status: "open",
        items: [{ product_id: String(product._id), max_qty_total: 10 }],
      },
      String((await makeUser())._id)
    )) as { _id: unknown; items: Array<{ _id: unknown }> };
    const input = {
      round_id: String(round._id),
      order_type: "takeaway" as const,
      promotion_code: promo.promotion_code,
      items: [{ round_item_id: String(round.items[0]._id), quantity: 2 }],
    };

    failNextUsageRecord();
    await expect(preorderService.createPreorder(uid, input, { storefront: true })).rejects.toThrow();

    expect(await preorderModel.countDocuments({ user_id: uid })).toBe(0);
    expect((await promotionModel.findById(promo._id).lean<{ used_count?: number }>())!.used_count ?? 0).toBe(0);
    expect(await promotionUsagesModel.countDocuments({ promotion_id: promo._id })).toBe(0);

    // สั่งใหม่ได้ (โควตารอบถูกคืนแล้ว)
    const pre = (await preorderService.createPreorder(uid, input, { storefront: true })) as { discount_amount: number };
    expect(pre.discount_amount).toBe(20);
  });
});
