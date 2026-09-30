import { describe, it, expect } from "vitest";
import {
  generateProductCode,
  isProductCode,
  isPreorderProduct,
  isPreorderOf,
  isPreorderFilterFrom,
  productCodePrefix,
  generateDocNo,
} from "@/lib/productCode";

describe("generateProductCode", () => {
  it("สินค้าปกติ → prefix pos- · พรีออเดอร์ → prefix pre-", () => {
    expect(generateProductCode(false)).toMatch(/^pos-\d{7}$/);
    expect(generateProductCode(true)).toMatch(/^pre-\d{7}$/);
    expect(productCodePrefix(false)).toBe("pos");
    expect(productCodePrefix(true)).toBe("pre");
  });

  it("DDYY มาจากวันที่ที่ส่งเข้า (5 ม.ค. 2026 → 0526)", () => {
    const code = generateProductCode(false, new Date(2026, 0, 5));
    expect(code).toMatch(/^pos-0526\d{3}$/);
  });
});

describe("isPreorderProduct", () => {
  it("true เฉพาะ is_preorder === true", () => {
    expect(isPreorderProduct({ is_preorder: true })).toBe(true);
    expect(isPreorderProduct({ is_preorder: false })).toBe(false);
    expect(isPreorderProduct({})).toBe(false);
    expect(isPreorderProduct(null)).toBe(false);
    expect(isPreorderProduct({ is_preorder: "true" })).toBe(false); // ไม่ใช่ boolean — ไม่เดา
  });
});

describe("isPreorderOf — อ่านเอกสารดิบทุกรุ่น (สคริปต์ migrate)", () => {
  it("is_preorder มาก่อนเสมอ", () => {
    expect(isPreorderOf({ is_preorder: true, product_types: ["inStore"] })).toBe(true);
    expect(isPreorderOf({ is_preorder: false })).toBe(false);
  });

  it("product_types (รุ่น 2026-09-24)", () => {
    expect(isPreorderOf({ product_types: ["preorder"] })).toBe(true);
    expect(isPreorderOf({ product_types: ["inStore", "online"] })).toBe(false);
    expect(isPreorderOf({ product_types: ["online"] })).toBe(false);
  });

  it("product_type (รุ่นแรก) รวม ready = สินค้าปกติ", () => {
    expect(isPreorderOf({ product_type: "preorder" })).toBe(true);
    expect(isPreorderOf({ product_type: "inStore" })).toBe(false);
    expect(isPreorderOf({ product_type: "ready" })).toBe(false);
  });

  it("ตัดสินไม่ได้ → null", () => {
    expect(isPreorderOf({})).toBeNull();
    expect(isPreorderOf({ product_types: [] })).toBeNull();
    expect(isPreorderOf({ product_types: ["bogus"] })).toBeNull();
    expect(isPreorderOf({ product_type: "bogus" })).toBeNull();
  });
});

describe("isPreorderFilterFrom — query string รายการสินค้า", () => {
  const q = (s: string) => isPreorderFilterFrom(new URLSearchParams(s));
  it("?is_preorder= ใหม่", () => {
    expect(q("is_preorder=true")).toBe(true);
    expect(q("is_preorder=false")).toBe(false);
  });
  it("?product_type= เดิมยังรับ (preorder=true, inStore/online=false)", () => {
    expect(q("product_type=preorder")).toBe(true);
    expect(q("product_type=inStore")).toBe(false);
    expect(q("product_type=online")).toBe(false);
  });
  it("ไม่ส่ง / ค่าแปลก → undefined (ทั้งหมด)", () => {
    expect(q("")).toBeUndefined();
    expect(q("product_type=bogus")).toBeUndefined();
  });
});

describe("isProductCode", () => {
  it("รับรหัสที่ถูกต้อง (+ trim)", () => {
    expect(isProductCode("pos-0526123")).toBe(true);
    expect(isProductCode("pre-3199000")).toBe(true);
    expect(isProductCode("  pos-0526123  ")).toBe(true);
  });

  it("ปฏิเสธรูปแบบผิด / ค่าที่ไม่ใช่ string", () => {
    expect(isProductCode("pos-123")).toBe(false);
    expect(isProductCode("abc-0526123")).toBe(false);
    expect(isProductCode("0526123")).toBe(false);
    expect(isProductCode(12345)).toBe(false);
    expect(isProductCode(null)).toBe(false);
  });
});

describe("generateDocNo (BACKLOG3 — ตัวสร้างเลขที่เอกสารกลาง แทน randomOrderNo/randomPreorderNo/randomProductionNo เดิมที่ซ้ำกัน 3 จุด)", () => {
  it("รูปแบบ <prefix>-YYYYMMDD-<random ตัวพิมพ์ใหญ่> ความยาวสุ่มตามที่ระบุ (default 6)", () => {
    expect(generateDocNo("OP")).toMatch(/^OP-\d{8}-[A-Z0-9]{6}$/);
    expect(generateDocNo("PRD", 5)).toMatch(/^PRD-\d{8}-[A-Z0-9]{5}$/);
  });

  it("YYYYMMDD มาจากวันที่ที่ส่งเข้า (5 ม.ค. 2026 → 20260105)", () => {
    const no = generateDocNo("PRE", 6, new Date(2026, 0, 5));
    expect(no.startsWith("PRE-20260105-")).toBe(true);
  });

  it("สุ่มไม่ซ้ำกันในทางปฏิบัติ (เรียกซ้ำ ๆ ไม่ควรได้ค่าเดิม)", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateDocNo("OP")));
    expect(values.size).toBeGreaterThan(1);
  });
});

