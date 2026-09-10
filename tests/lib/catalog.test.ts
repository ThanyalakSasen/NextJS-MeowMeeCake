import { describe, it, expect } from "vitest";
import {
  unitCreate,
  unitUpdate,
  productCategoryCreate,
  bannerCreate,
  bannerUpdate,
} from "@/schemas/catalog";

describe("schemas/catalog — unit", () => {
  const ok = {
    unit_name: "กรัม",
    unit_abbr: "g",
    unit_type: "IngredientWeight",
    usage_context: ["Ingredient"],
  };

  it("create: ครบ + enum ถูก → ผ่าน", () => {
    expect(unitCreate.parse(ok)).toMatchObject({ unit_name: "กรัม", unit_type: "IngredientWeight" });
  });

  it("create: unit_type นอก enum / usage_context ว่าง → fail", () => {
    expect(unitCreate.safeParse({ ...ok, unit_type: "Weight" }).success).toBe(false);
    expect(unitCreate.safeParse({ ...ok, usage_context: [] }).success).toBe(false);
  });

  it("create: ขาด field → fail · update: partial (แก้ field เดียวได้)", () => {
    expect(unitCreate.safeParse({ unit_name: "x" }).success).toBe(false);
    expect(unitUpdate.safeParse({ unit_abbr: "kg" }).success).toBe(true);
    expect(unitUpdate.safeParse({}).success).toBe(true);
  });
});

describe("schemas/catalog — productCategory", () => {
  it("ต้องมีชื่อ ไม่ว่าง", () => {
    expect(productCategoryCreate.safeParse({ product_category_name: "เค้ก" }).success).toBe(true);
    expect(productCategoryCreate.safeParse({ product_category_name: "  " }).success).toBe(false);
    expect(productCategoryCreate.safeParse({}).success).toBe(false);
  });
});

describe("schemas/catalog — banner", () => {
  const ok = { banner_name: "โปรปีใหม่", banner_img: "https://x/y.jpg", sort_order: 0 };

  it("create: required = name/img/sort_order", () => {
    expect(bannerCreate.parse(ok)).toMatchObject({ banner_name: "โปรปีใหม่", sort_order: 0 });
    expect(bannerCreate.safeParse({ banner_name: "x", sort_order: 0 }).success).toBe(false); // ไม่มี img
    expect(bannerCreate.safeParse({ ...ok, sort_order: -1 }).success).toBe(false);
  });

  it("create: start_date รับ string → coerce เป็น Date", () => {
    const r = bannerCreate.parse({ ...ok, start_date: "2026-01-01" });
    expect(r.start_date).toBeInstanceOf(Date);
  });

  it("create: start_date ที่ parse ไม่ได้ → fail", () => {
    expect(bannerCreate.safeParse({ ...ok, start_date: "not-a-date" }).success).toBe(false);
  });

  it("update: partial", () => {
    expect(bannerUpdate.safeParse({ is_active: false }).success).toBe(true);
  });
});
