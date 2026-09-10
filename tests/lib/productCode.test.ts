import { describe, it, expect } from "vitest";
import {
  generateProductCode,
  isProductCode,
  isStockProductType,
} from "@/lib/productCode";

describe("generateProductCode", () => {
  it("inStore / online → prefix pos-", () => {
    expect(generateProductCode("inStore")).toMatch(/^pos-\d{7}$/);
    expect(generateProductCode("online")).toMatch(/^pos-\d{7}$/);
  });

  it("preorder → prefix pre-", () => {
    expect(generateProductCode("preorder")).toMatch(/^pre-\d{7}$/);
  });

  it("DDYY มาจากวันที่ที่ส่งเข้า (5 ม.ค. 2026 → 0526)", () => {
    const code = generateProductCode("inStore", new Date(2026, 0, 5));
    expect(code.startsWith("pos-0526")).toBe(true);
    expect(code).toMatch(/^pos-0526\d{3}$/);
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

describe("isStockProductType", () => {
  it("inStore / online = มีสต็อก", () => {
    expect(isStockProductType("inStore")).toBe(true);
    expect(isStockProductType("online")).toBe(true);
  });
  it("preorder / อื่น ๆ = ไม่มีสต็อก", () => {
    expect(isStockProductType("preorder")).toBe(false);
    expect(isStockProductType("ready")).toBe(false);
    expect(isStockProductType(undefined)).toBe(false);
  });
});
