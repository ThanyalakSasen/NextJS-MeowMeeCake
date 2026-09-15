import { describe, it, expect } from "vitest";
import { createPreorderBody, listPreorderQuery } from "@/schemas/preorder";

const OID = "507f1f77bcf86cd799439011";
const OID2 = "507f1f77bcf86cd799439012";

describe("schemas/preorder — createPreorderBody (BACKLOG2 §8)", () => {
  it("takeaway ต้องมี round_id + items ≥ 1 ก็ผ่านโดยไม่ต้องมีที่อยู่", () => {
    expect(
      createPreorderBody.safeParse({
        round_id: OID,
        order_type: "takeaway",
        items: [{ round_item_id: OID2, quantity: 1 }],
      }).success
    ).toBe(true);
  });

  it("ไม่มี items เลย → fail", () => {
    expect(
      createPreorderBody.safeParse({ round_id: OID, order_type: "takeaway", items: [] }).success
    ).toBe(false);
  });

  it("order_type นอก enum / quantity < 1 → fail", () => {
    expect(
      createPreorderBody.safeParse({
        round_id: OID,
        order_type: "dine-in",
        items: [{ round_item_id: OID2, quantity: 1 }],
      }).success
    ).toBe(false);
    expect(
      createPreorderBody.safeParse({
        round_id: OID,
        order_type: "takeaway",
        items: [{ round_item_id: OID2, quantity: 0 }],
      }).success
    ).toBe(false);
  });

  it("round_id / round_item_id รูปแบบผิด → fail", () => {
    expect(
      createPreorderBody.safeParse({
        round_id: "not-an-id",
        order_type: "takeaway",
        items: [{ round_item_id: OID2, quantity: 1 }],
      }).success
    ).toBe(false);
  });
});

describe("schemas/preorder — address_id / delivery_address oneOf (BACKLOG §3.8 gap ปิดแล้ว)", () => {
  const base = { round_id: OID, items: [{ round_item_id: OID2, quantity: 1 }] };

  it("delivery + ไม่ระบุที่อยู่เลย → fail", () => {
    expect(createPreorderBody.safeParse({ ...base, order_type: "delivery" }).success).toBe(false);
  });

  it("delivery + ระบุทั้ง address_id และ delivery_address พร้อมกัน → fail", () => {
    expect(
      createPreorderBody.safeParse({
        ...base,
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
      createPreorderBody.safeParse({ ...base, order_type: "delivery", address_id: OID }).success
    ).toBe(false);
  });

  it("delivery + address_id + recipient_name/phone ครบ → ผ่าน", () => {
    expect(
      createPreorderBody.safeParse({
        ...base,
        order_type: "delivery",
        address_id: OID,
        recipient_name: "สมชาย",
        recipient_phone: "0812345678",
      }).success
    ).toBe(true);
  });

  it("delivery + delivery_address อย่างเดียว (แบบเดิม) → ผ่าน", () => {
    expect(
      createPreorderBody.safeParse({
        ...base,
        order_type: "delivery",
        delivery_address: { recipient_name: "ก", house_no: "1" },
      }).success
    ).toBe(true);
  });
});

describe("schemas/preorder — listPreorderQuery", () => {
  it("รับ enum ที่ถูก, ปฏิเสธที่ผิด", () => {
    expect(listPreorderQuery.parse({ order_status: "ready" })).toEqual({ order_status: "ready" });
    expect(listPreorderQuery.safeParse({ order_status: "flying" }).success).toBe(false);
    expect(listPreorderQuery.safeParse({ payment_status: "paid" }).success).toBe(true);
    expect(listPreorderQuery.safeParse({ round_id: "not-an-id" }).success).toBe(false);
  });
});
