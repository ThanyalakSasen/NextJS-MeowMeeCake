import { describe, it, expect } from "vitest";
import { toSatang, toBaht, percentOfSatang, toSatangFields, toBahtFields, round2 } from "@/lib/money";

/**
 * หน่วยเงิน = บาท ทั้ง DB และ API (docs/money-units.md — ยกเลิกการเก็บสตางค์ของ BACKLOG §3.11 เมื่อ 2026-10-01
 * เพราะ FrontOffice เขียน DB ตรงเป็นบาท) · toSatang/toBaht ชื่อเดิม แต่ตอนนี้แค่ปัดทศนิยม 2 ตำแหน่ง
 */
describe("money.toSatang / toBaht (บาท ปัด 2 ตำแหน่ง)", () => {
  it("ค่าบาทปกติ → เท่าเดิม (ไม่คูณ/หาร 100 แล้ว)", () => {
    expect(toSatang(100)).toBe(100);
    expect(toSatang(0)).toBe(0);
    expect(toSatang(1.5)).toBe(1.5);
    expect(toBaht(35)).toBe(35);
    expect(toBaht(19.99)).toBe(19.99);
  });

  it("ปัดเศษ float ค้างให้เหลือ 2 ตำแหน่ง", () => {
    expect(toSatang(0.1 + 0.2)).toBe(0.3); // 0.30000000000000004 ใน JS ดิบ
    expect(toSatang(29.9 * 3)).toBe(89.7); // 89.69999999999999 ใน JS ดิบ
    expect(toBaht(1 / 3)).toBe(0.33);
    expect(toSatang(1.005)).toBe(1.01); // Number.EPSILON กันปัดลงผิด
  });
});

describe("money.percentOfSatang", () => {
  it("คิดเปอร์เซ็นต์ของยอดบาทแล้วปัด 2 ตำแหน่ง", () => {
    expect(percentOfSatang(100, 15)).toBe(15);
    expect(percentOfSatang(99.99, 10)).toBe(10);
  });
});

describe("money.round2", () => {
  it("ปัดบาททศนิยมให้เหลือ 2 ตำแหน่งเสมอ", () => {
    expect(round2(19.999)).toBe(20);
    expect(round2(1 / 3)).toBe(0.33);
    expect(round2(100)).toBe(100);
    expect(round2(0)).toBe(0);
  });
});

describe("money.toSatangFields / toBahtFields", () => {
  it("ปัดเฉพาะ key ที่ระบุ ข้าม null/undefined และ field อื่นที่ไม่ใช่ตัวเลข", () => {
    const input = { subtotal: 100.004, discount_amount: null, note: "x", total_amount: 80 };
    const out = toSatangFields(input, ["subtotal", "discount_amount", "total_amount"] as const);
    expect(out).toEqual({ subtotal: 100, discount_amount: null, note: "x", total_amount: 80 });
  });

  it("toBahtFields คืน object ใหม่ ไม่แก้ object เดิม", () => {
    const input = { subtotal: 0.1 + 0.2, total_amount: 80 };
    const out = toBahtFields(input, ["subtotal", "total_amount"] as const);
    expect(out).toEqual({ subtotal: 0.3, total_amount: 80 });
    expect(input.subtotal).toBe(0.1 + 0.2);
  });
});
