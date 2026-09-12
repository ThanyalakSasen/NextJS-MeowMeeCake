import { describe, it, expect } from "vitest";
import { createOrderBody, adminCreateOrderBody, listOrderQuery } from "@/schemas/order";
import { addCartItemBody, updateCartItemBody } from "@/schemas/cart";
import { createPaymentBody, submitSlipBody } from "@/schemas/payment";

const OID = "507f1f77bcf86cd799439011";

describe("schemas/order — createOrderBody", () => {
  it("default source=cart, selected_options=[]", () => {
    const r = createOrderBody.parse({ order_type: "takeaway" });
    expect(r.source).toBe("cart");
  });

  it("source=items ต้องมี items ≥ 1", () => {
    expect(createOrderBody.safeParse({ source: "items", order_type: "takeaway" }).success).toBe(false);
    expect(
      createOrderBody.safeParse({
        source: "items",
        order_type: "takeaway",
        items: [{ product_id: OID, quantity: 2 }],
      }).success
    ).toBe(true);
  });

  it("ส่งทั้ง promotion_code และ promotion_id → fail", () => {
    expect(
      createOrderBody.safeParse({
        order_type: "delivery",
        promotion_code: "X",
        promotion_id: OID,
      }).success
    ).toBe(false);
  });

  it("order_type นอก enum / quantity < 1 → fail", () => {
    expect(createOrderBody.safeParse({ order_type: "dine-in" }).success).toBe(false);
    expect(
      createOrderBody.safeParse({
        source: "items",
        order_type: "takeaway",
        items: [{ product_id: OID, quantity: 0 }],
      }).success
    ).toBe(false);
  });
});

describe("schemas/order — adminCreateOrderBody (BACKLOG §3.1, รอบ 4b)", () => {
  it("ต้องมี user_id, refine เดียวกับ createOrderBody ยังใช้ได้", () => {
    expect(adminCreateOrderBody.safeParse({ order_type: "takeaway" }).success).toBe(false); // ไม่มี user_id
    const r = adminCreateOrderBody.parse({ user_id: OID, order_type: "takeaway" });
    expect(r.user_id).toBe(OID);
    expect(r.channel).toBe("instore"); // default
    expect(
      adminCreateOrderBody.safeParse({
        user_id: OID,
        order_type: "delivery",
        promotion_code: "X",
        promotion_id: OID,
      }).success
    ).toBe(false);
  });

  it("รับ delivery_fee / discount_amount override, coerce จาก string ได้", () => {
    const r = adminCreateOrderBody.parse({
      user_id: OID,
      order_type: "takeaway",
      delivery_fee: "50",
      discount_amount: "20",
      channel: "online",
    });
    expect(r.delivery_fee).toBe(50);
    expect(r.discount_amount).toBe(20);
    expect(r.channel).toBe("online");
  });

  it("delivery_fee ติดลบ → fail", () => {
    expect(
      adminCreateOrderBody.safeParse({ user_id: OID, order_type: "takeaway", delivery_fee: -1 })
        .success
    ).toBe(false);
  });
});

describe("schemas/order — listOrderQuery", () => {
  it("รับ enum ที่ถูก, ปฏิเสธที่ผิด", () => {
    expect(listOrderQuery.parse({ order_status: "ready" })).toEqual({ order_status: "ready" });
    expect(listOrderQuery.safeParse({ order_status: "flying" }).success).toBe(false);
  });
});

describe("schemas/cart", () => {
  it("addCartItemBody: product_id ต้องเป็น ObjectId, quantity ≥ 1", () => {
    expect(addCartItemBody.safeParse({ product_id: "nope", quantity: 1 }).success).toBe(false);
    const r = addCartItemBody.parse({ product_id: OID, quantity: 3 });
    expect(r.selected_options).toEqual([]);
  });

  it("updateCartItemBody: quantity 0 ได้ (= ลบ), ติดลบไม่ได้", () => {
    expect(updateCartItemBody.safeParse({ quantity: 0 }).success).toBe(true);
    expect(updateCartItemBody.safeParse({ quantity: -1 }).success).toBe(false);
  });
});

describe("schemas/payment", () => {
  it("createPaymentBody: ต้องมี order_id หรือ preorder_id อย่างใดอย่างหนึ่ง", () => {
    expect(createPaymentBody.safeParse({ amount: 100 }).success).toBe(false);
    expect(
      createPaymentBody.safeParse({ order_id: OID, preorder_id: OID, amount: 100 }).success
    ).toBe(false);
    expect(createPaymentBody.safeParse({ order_id: OID, amount: 100 }).success).toBe(true);
  });

  it("createPaymentBody: amount ต้อง > 0", () => {
    expect(createPaymentBody.safeParse({ order_id: OID, amount: 0 }).success).toBe(false);
  });

  it("submitSlipBody: slip_image_url ห้ามว่าง", () => {
    expect(submitSlipBody.safeParse({ slip_image_url: "" }).success).toBe(false);
    expect(submitSlipBody.safeParse({ slip_image_url: "https://x/y.jpg" }).success).toBe(true);
  });
});
