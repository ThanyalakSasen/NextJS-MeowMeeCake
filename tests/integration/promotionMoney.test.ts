import { describe, it, expect } from "vitest";
import type { z } from "zod";
import promotionModel from "@/models/promotionModel";
import * as promotionService from "@/services/promotionService";
import { promotionCreate, promotionUpdate } from "@/schemas/promotion";
import { makeUser } from "./helpers";

/**
 * BACKLOG §3.11 เฟส 5a — promotionModel เก็บเงินเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยมเหมือนเดิม
 *
 * ซับซ้อนกว่าเฟสอื่นเพราะ discount_value เป็นเงิน "เฉพาะ" ตอน discount_type === "Amount" — ตอน
 * "Percentage" เป็นตัวเลข % ดิบ ไม่แปลง ส่วน min_order_amount/max_discount_amount เป็นเงินเสมอ
 */
type CreateInput = z.infer<typeof promotionCreate>;
type UpdateInput = z.infer<typeof promotionUpdate>;

interface PromoDoc {
  _id: unknown;
  discount_value: number;
  min_order_amount?: number | null;
  max_discount_amount?: number | null;
}

function base(over: Partial<CreateInput> = {}): CreateInput {
  return {
    promotion_code: "T" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    promotion_name: "โปรทดสอบ",
    discount_type: "Amount",
    discount_value: 50,
    start_date: new Date(),
    end_date: new Date(Date.now() + 86_400_000),
    ...over,
  };
}

describe("promotionService.createPromotion/updatePromotion — discount_value เงินเฉพาะตอน Amount", () => {
  it("Amount: discount_value แปลงเป็นสตางค์ คืน API เป็นบาท", async () => {
    const user = await makeUser();
    const created = (await promotionService.createPromotion(
      base({ discount_type: "Amount", discount_value: 50 }),
      String(user._id)
    )) as PromoDoc;
    expect(created.discount_value).toBe(50);

    const raw = await promotionModel.findById(created._id).lean<{ discount_value: number }>();
    expect(raw!.discount_value).toBe(5000);
  });

  it("Percentage: discount_value ไม่ถูกแปลง (ยังเป็น % ดิบ 0-100)", async () => {
    const user = await makeUser();
    const created = (await promotionService.createPromotion(
      base({ discount_type: "Percentage", discount_value: 15 }),
      String(user._id)
    )) as PromoDoc;
    expect(created.discount_value).toBe(15);

    const raw = await promotionModel.findById(created._id).lean<{ discount_value: number }>();
    expect(raw!.discount_value).toBe(15); // ไม่ถูกคูณ 100
  });

  it("FreeShipping: discount_value (0) ไม่ถูกแตะเช่นกัน", async () => {
    const user = await makeUser();
    const created = (await promotionService.createPromotion(
      base({ discount_type: "FreeShipping", discount_value: 0 }),
      String(user._id)
    )) as PromoDoc;
    const raw = await promotionModel.findById(created._id).lean<{ discount_value: number }>();
    expect(raw!.discount_value).toBe(0);
  });

  it("min_order_amount/max_discount_amount แปลงเป็นสตางค์เสมอไม่ว่า discount_type ใด", async () => {
    const user = await makeUser();
    const created = (await promotionService.createPromotion(
      base({
        discount_type: "Percentage",
        discount_value: 10,
        min_order_amount: 200,
        max_discount_amount: 80,
      }),
      String(user._id)
    )) as PromoDoc;
    expect(created.min_order_amount).toBe(200);
    expect(created.max_discount_amount).toBe(80);

    const raw = await promotionModel.findById(created._id).lean<{
      min_order_amount: number;
      max_discount_amount: number;
    }>();
    expect(raw!.min_order_amount).toBe(20000);
    expect(raw!.max_discount_amount).toBe(8000);
  });

  it("update: เปลี่ยน discount_value ของโปร Amount ที่มีอยู่แล้ว แปลงถูกทาง", async () => {
    const user = await makeUser();
    const created = (await promotionService.createPromotion(
      base({ discount_type: "Amount", discount_value: 50 }),
      String(user._id)
    )) as PromoDoc;
    const updated = (await promotionService.updatePromotion(String(created._id), {
      discount_value: 70,
    } as UpdateInput)) as PromoDoc;
    expect(updated.discount_value).toBe(70);
    const raw = await promotionModel.findById(created._id).lean<{ discount_value: number }>();
    expect(raw!.discount_value).toBe(7000);
  });

  it("update: ส่ง discount_type ใหม่พร้อม discount_value ในคำขอเดียวกัน ใช้ type ใหม่ตัดสินใจแปลง", async () => {
    const user = await makeUser();
    const created = (await promotionService.createPromotion(
      base({ discount_type: "Percentage", discount_value: 10 }),
      String(user._id)
    )) as PromoDoc;
    // เปลี่ยนเป็น Amount พร้อมส่ง discount_value ใหม่มาด้วย (บาท) ในคำขอเดียวกัน — ต้องแปลงเป็นสตางค์
    const updated = (await promotionService.updatePromotion(String(created._id), {
      discount_type: "Amount",
      discount_value: 99,
    } as UpdateInput)) as PromoDoc;
    expect(updated.discount_value).toBe(99);
    const raw = await promotionModel.findById(created._id).lean<{ discount_value: number }>();
    expect(raw!.discount_value).toBe(9900);
  });

  it("update: ไม่ได้ส่ง discount_value มาด้วยเลย → ค่าเดิมใน DB ไม่ถูกแตะ แม้จะเปลี่ยน discount_type", async () => {
    const user = await makeUser();
    const created = (await promotionService.createPromotion(
      base({ discount_type: "Percentage", discount_value: 10 }),
      String(user._id)
    )) as PromoDoc;
    // เปลี่ยน type เป็น Amount แต่ไม่ส่ง discount_value มาด้วย — ค่าเดิม (10, ยังไม่เคยถูกแปลง) ต้องคงเดิม
    await promotionService.updatePromotion(String(created._id), {
      discount_type: "Amount",
    } as UpdateInput);
    const raw = await promotionModel.findById(created._id).lean<{ discount_value: number }>();
    expect(raw!.discount_value).toBe(10); // ไม่ถูกคูณย้อนหลัง
  });

  it("list/getById คืนค่าเป็นบาทเสมอ ตามชนิดของแต่ละโปรโมชัน", async () => {
    const user = await makeUser();
    const amountPromo = (await promotionService.createPromotion(
      base({ discount_type: "Amount", discount_value: 25 }),
      String(user._id)
    )) as PromoDoc;
    const pctPromo = (await promotionService.createPromotion(
      base({ discount_type: "Percentage", discount_value: 20 }),
      String(user._id)
    )) as PromoDoc;

    const byId = (await promotionService.getPromotionById(String(amountPromo._id))) as PromoDoc;
    expect(byId.discount_value).toBe(25);

    const { items } = await promotionService.listPromotions({
      pagination: { page: 1, limit: 20, skip: 0 },
    });
    const foundAmount = (items as PromoDoc[]).find(
      (it) => String(it._id) === String(amountPromo._id)
    );
    const foundPct = (items as PromoDoc[]).find((it) => String(it._id) === String(pctPromo._id));
    expect(foundAmount?.discount_value).toBe(25);
    expect(foundPct?.discount_value).toBe(20); // % ไม่ถูกแปลง
  });
});

describe("promotionService.validateForOrder — แปลงข้ามโดเมนไปหา discountEngine (บาทล้วน)", () => {
  it("Amount + min_order_amount: เทียบเกณฑ์ขั้นต่ำถูกหน่วย ไม่ถูกปฏิเสธผิดพลาด", async () => {
    const user = await makeUser();
    const promo = (await promotionService.createPromotion(
      base({
        discount_type: "Amount",
        discount_value: 30,
        min_order_amount: 100, // บาท
      }),
      String(user._id)
    )) as PromoDoc;

    // subtotal 150 บาท ≥ min_order_amount 100 บาท → ผ่าน ไม่ throw
    const result = await promotionService.validateForOrder({
      promotion_id: String(promo._id),
      user_id: String(user._id),
      lines: [{ product_id: "p1", quantity: 1, line_total: 150 }],
      subtotal: 150,
      delivery_fee: 0,
    });
    expect(result.discount_amount).toBe(30); // บาท ไม่ใช่ 3000

    // ถ้าไม่แปลง min_order_amount (สตางค์ 10000) เทียบกับ subtotal บาท (150) ตรง ๆ จะ reject ผิดพลาด
    // เพราะ 150 < 10000 — เทสนี้ยืนยันว่าไม่เกิดเหตุการณ์นั้น
  });

  it("Amount + min_order_amount: ยอดไม่ถึงขั้นต่ำจริง (เทียบเป็นบาทถูกต้อง) → reject", async () => {
    const user = await makeUser();
    const promo = (await promotionService.createPromotion(
      base({
        discount_type: "Amount",
        discount_value: 30,
        min_order_amount: 200,
      }),
      String(user._id)
    )) as PromoDoc;

    await expect(
      promotionService.validateForOrder({
        promotion_id: String(promo._id),
        user_id: String(user._id),
        lines: [{ product_id: "p1", quantity: 1, line_total: 150 }],
        subtotal: 150,
        delivery_fee: 0,
      })
    ).rejects.toThrow(/ขั้นต่ำ/);
  });

  it("Percentage + max_discount_amount cap: cap แปลงเป็นบาทถูกต้อง ไม่ cap เพี้ยน x100", async () => {
    const user = await makeUser();
    const promo = (await promotionService.createPromotion(
      base({
        discount_type: "Percentage",
        discount_value: 50, // 50%
        max_discount_amount: 40, // cap ที่ 40 บาท
      }),
      String(user._id)
    )) as PromoDoc;

    // eligible 100 บาท * 50% = 50 บาท แต่ถูก cap ที่ 40 บาท
    const result = await promotionService.validateForOrder({
      promotion_id: String(promo._id),
      user_id: String(user._id),
      lines: [{ product_id: "p1", quantity: 1, line_total: 100 }],
      subtotal: 100,
      delivery_fee: 0,
    });
    expect(result.discount_amount).toBe(40); // ไม่ใช่ 50 (cap ทำงาน) และไม่ใช่ 4000 (หน่วยไม่เพี้ยน)
  });
});
