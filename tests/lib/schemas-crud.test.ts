import { describe, it, expect } from "vitest";
import {
  productOptionCreate,
  productOptionUpdate,
  productVariantCreate,
  productVariantUpdate,
} from "@/schemas/catalog";
import {
  aspectCreate,
  aspectUpdate,
  semanticTermCreate,
  semanticTermUpdate,
} from "@/schemas/sentiment";
import { roleCreate, roleUpdate } from "@/schemas/rbac";

const OID = "5f9d88b9c3a1e2b3c4d5e6f7";

describe("schemas/catalog — productOption", () => {
  const ok = { product_id: OID, option_name: "เขียนข้อความ", extra_price: 50 };

  it("create: required product_id + option_name", () => {
    expect(productOptionCreate.parse(ok)).toMatchObject({ option_name: "เขียนข้อความ", extra_price: 50 });
    expect(productOptionCreate.safeParse({ option_name: "x" }).success).toBe(false); // ไม่มี product_id
    expect(productOptionCreate.safeParse({ ...ok, product_id: "nope" }).success).toBe(false);
  });

  it("create: extra_price รับ string → coerce, ติดลบ → fail", () => {
    expect(productOptionCreate.parse({ ...ok, extra_price: "20" }).extra_price).toBe(20);
    expect(productOptionCreate.safeParse({ ...ok, extra_price: -1 }).success).toBe(false);
  });

  it("update: partial + ห้ามมี product_id (ถูก strip)", () => {
    const r = productOptionUpdate.parse({ product_id: OID, extra_price: 10 });
    expect(r).not.toHaveProperty("product_id");
    expect(productOptionUpdate.safeParse({}).success).toBe(true);
  });
});

describe("schemas/catalog — productVariant", () => {
  const ok = { product_id: OID, variant_name: "ขนาด 2 ปอนด์" };

  it("create: required + ราคา/สต็อกติดลบ → fail", () => {
    expect(productVariantCreate.parse(ok)).toMatchObject({ variant_name: "ขนาด 2 ปอนด์" });
    expect(productVariantCreate.safeParse({ ...ok, variant_price: -5 }).success).toBe(false);
    expect(productVariantCreate.safeParse({ ...ok, variant_stock: -1 }).success).toBe(false);
  });

  it("create: unit_id ผิดรูป → fail · update: strip product_id", () => {
    expect(productVariantCreate.safeParse({ ...ok, unit_id: "bad" }).success).toBe(false);
    expect(productVariantUpdate.parse({ product_id: OID, variant_name: "y" })).not.toHaveProperty(
      "product_id"
    );
  });
});

describe("schemas/sentiment — aspect", () => {
  it("create: ต้องมีชื่อ th/eng, desc เป็น null ได้", () => {
    expect(
      aspectCreate.parse({ aspect_name_th: "รสชาติ", aspect_name_eng: "taste", aspect_desc: null })
    ).toMatchObject({ aspect_name_th: "รสชาติ" });
    expect(aspectCreate.safeParse({ aspect_name_th: "x" }).success).toBe(false);
    expect(aspectUpdate.safeParse({ aspect_desc: "note" }).success).toBe(true);
  });
});

describe("schemas/sentiment — semanticTerm", () => {
  const ok = { term: "อร่อย", aspect_id: OID };

  it("create: required term + aspect_id, synonyms เป็น array ของ string", () => {
    expect(semanticTermCreate.parse({ ...ok, synonyms: ["ดี", "เยี่ยม"] }).synonyms).toEqual([
      "ดี",
      "เยี่ยม",
    ]);
    expect(semanticTermCreate.safeParse({ term: "x" }).success).toBe(false);
    expect(semanticTermCreate.safeParse({ ...ok, product_ids: ["bad"] }).success).toBe(false);
  });

  it("update: partial", () => {
    expect(semanticTermUpdate.safeParse({ term: "ใหม่" }).success).toBe(true);
  });
});

describe("schemas/rbac — role", () => {
  it("create: role_type enum, is_active optional", () => {
    expect(roleCreate.parse({ role_name: "แคชเชียร์", role_type: "staff" })).toMatchObject({
      role_type: "staff",
    });
    expect(roleCreate.safeParse({ role_name: "x", role_type: "admin" }).success).toBe(false);
    expect(roleUpdate.safeParse({ is_active: false }).success).toBe(true);
  });
});
