import { describe, it, expect } from "vitest";
import { computeDiscount, type DiscountContext } from "@/lib/discountEngine";

/** promo doc ขั้นต่ำ + override ได้ */
function promo(over: Record<string, unknown> = {}) {
  return {
    _id: "PROMO1",
    promotion_code: "SAVE",
    discount_type: "Percentage",
    discount_value: 10,
    ...over,
  };
}

function ctx(over: Partial<DiscountContext> = {}): DiscountContext {
  return {
    lines: [{ product_id: "P1", category_id: "C1", quantity: 2, line_total: 800 }],
    subtotal: 800,
    delivery_fee: 40,
    channel: "online",
    ...over,
  };
}

describe("computeDiscount — Percentage", () => {
  it("คิด % จาก eligible amount", () => {
    const r = computeDiscount(promo({ discount_type: "Percentage", discount_value: 20 }), ctx());
    expect(r.discount_amount).toBe(160);
    expect(r.free_shipping).toBe(false);
    expect(r.eligible_amount).toBe(800);
  });

  it("cap ด้วย max_discount_amount", () => {
    const r = computeDiscount(
      promo({ discount_type: "Percentage", discount_value: 20, max_discount_amount: 100 }),
      ctx()
    );
    expect(r.discount_amount).toBe(100);
  });

  it("discount_value = 0 → reject (BACKLOG 2.11)", () => {
    expect(() =>
      computeDiscount(promo({ discount_type: "Percentage", discount_value: 0 }), ctx())
    ).toThrowError(/ไม่ให้ส่วนลด/);
  });
});

describe("computeDiscount — Amount", () => {
  it("ลดตามจำนวนเงิน", () => {
    const r = computeDiscount(promo({ discount_type: "Amount", discount_value: 50 }), ctx());
    expect(r.discount_amount).toBe(50);
  });

  it("ไม่ลดเกินยอดสินค้าที่ร่วมรายการ", () => {
    const r = computeDiscount(promo({ discount_type: "Amount", discount_value: 5000 }), ctx());
    expect(r.discount_amount).toBe(800);
  });
});

describe("computeDiscount — FreeShipping (BACKLOG 2.6)", () => {
  it("ลดเท่าค่าส่งเมื่อมีค่าส่ง", () => {
    const r = computeDiscount(promo({ discount_type: "FreeShipping" }), ctx({ delivery_fee: 40 }));
    expect(r.discount_amount).toBe(40);
    expect(r.free_shipping).toBe(true);
  });

  it("reject เมื่อ delivery_fee = 0 (takeaway / ส่งฟรีอยู่แล้ว)", () => {
    expect(() =>
      computeDiscount(promo({ discount_type: "FreeShipping" }), ctx({ delivery_fee: 0 }))
    ).toThrowError(/ค่าจัดส่ง/);
  });
});

describe("computeDiscount — เงื่อนไข", () => {
  it("ช่องทางไม่ตรง → reject", () => {
    expect(() =>
      computeDiscount(promo({ applicable_channels: ["instore"] }), ctx({ channel: "online" }))
    ).toThrowError(/ช่องทาง/);
  });

  it("ยอดไม่ถึง min_order_amount → reject", () => {
    expect(() =>
      computeDiscount(promo({ min_order_amount: 1000 }), ctx({ subtotal: 800 }))
    ).toThrowError(/ขั้นต่ำ/);
  });

  it("จำนวนไม่ถึง min_quantity → reject", () => {
    expect(() =>
      computeDiscount(promo({ min_quantity: 5 }), ctx())
    ).toThrowError(/อย่างน้อย/);
  });

  it("scoped สินค้า → คิดจากเฉพาะรายการที่ร่วม", () => {
    const r = computeDiscount(
      promo({ discount_type: "Amount", discount_value: 1000, applicable_products: ["P1"] }),
      ctx({
        lines: [
          { product_id: "P1", category_id: null, quantity: 1, line_total: 300 },
          { product_id: "P2", category_id: null, quantity: 1, line_total: 500 },
        ],
      })
    );
    expect(r.eligible_amount).toBe(300);
    expect(r.discount_amount).toBe(300);
  });

  it("scoped แต่ไม่มีสินค้าที่ร่วม → reject", () => {
    expect(() =>
      computeDiscount(promo({ applicable_products: ["PX"] }), ctx())
    ).toThrowError(/ไม่มีสินค้าที่ร่วมรายการ/);
  });
});
