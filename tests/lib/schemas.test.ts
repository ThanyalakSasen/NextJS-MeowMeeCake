import { describe, it, expect } from "vitest";
import { createOrderBody, adminCreateOrderBody, listOrderQuery, updateDeliveryBody } from "@/schemas/order";
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

describe("schemas/order — address_id / delivery_address oneOf (BACKLOG §3.8, รอบ 4c)", () => {
  it("delivery + ไม่ระบุที่อยู่เลย → fail", () => {
    expect(createOrderBody.safeParse({ order_type: "delivery" }).success).toBe(false);
  });
  it("delivery + ระบุทั้ง address_id และ delivery_address พร้อมกัน → fail", () => {
    expect(
      createOrderBody.safeParse({
        order_type: "delivery",
        address_id: OID,
        recipient_name: "ก",
        recipient_phone: "0812345678",
        delivery_address: { recipient_name: "ก", house_no: "1" },
      }).success
    ).toBe(false);
  });
  it("delivery + address_id อย่างเดียวไม่มี recipient_name/phone → fail", () => {
    expect(
      createOrderBody.safeParse({ order_type: "delivery", address_id: OID }).success
    ).toBe(false);
  });
  it("delivery + address_id + recipient_name/phone ครบ → ผ่าน", () => {
    expect(
      createOrderBody.safeParse({
        order_type: "delivery",
        address_id: OID,
        recipient_name: "สมชาย",
        recipient_phone: "0812345678",
      }).success
    ).toBe(true);
  });
  it("delivery + delivery_address อย่างเดียว (แบบเดิม) → ผ่าน", () => {
    expect(
      createOrderBody.safeParse({
        order_type: "delivery",
        delivery_address: { recipient_name: "ก", house_no: "1" },
      }).success
    ).toBe(true);
  });
  it("takeaway ไม่ต้องมีที่อยู่เลยก็ผ่าน", () => {
    expect(createOrderBody.safeParse({ order_type: "takeaway" }).success).toBe(true);
  });
});

describe("schemas/order — updateDeliveryBody (BACKLOG §3, รอบ 4b ข้อ B2)", () => {
  it("รับทุกฟิลด์เป็น optional, enum delivery_status ถูกต้อง", () => {
    expect(updateDeliveryBody.safeParse({}).success).toBe(true);
    expect(updateDeliveryBody.safeParse({ delivery_status: "shipping" }).success).toBe(true);
    expect(updateDeliveryBody.safeParse({ delivery_status: "flying" }).success).toBe(false);
  });
  it("coerce shipped_at/delivered_at จาก string เป็น Date", () => {
    const r = updateDeliveryBody.parse({ shipped_at: "2026-01-10T00:00:00Z" });
    expect(r.shipped_at).toBeInstanceOf(Date);
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
