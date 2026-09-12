import { describe, it, expect } from "vitest";
import { toSatang, toBaht, percentOfSatang, toSatangFields, toBahtFields } from "@/lib/money";

/**
 * BACKLOG §3.11 — เก็บเงินเป็นสตางค์ (integer) แทนบาท (float) กันปัญหา floating-point สะสม error
 * เทสนี้คุมเคสที่ float ธรรมดาพังจริง (19.99*100 ใน JS ได้ 1998.9999999999998 ไม่ใช่ 1999 พอดี)
 */
describe("money.toSatang / toBaht", () => {
  it("แปลงบาทปกติเป็นสตางค์ตรง ๆ", () => {
    expect(toSatang(100)).toBe(10000);
    expect(toSatang(0)).toBe(0);
    expect(toSatang(1.5)).toBe(150);
  });

  it("กันปัญหา floating-point classic: 19.99 บาท ต้องได้ 1999 สตางค์เป๊ะ ไม่ใช่ 1998", () => {
    // JS ดิบ ๆ: 19.99 * 100 === 1998.9999999999998 (ไม่ใช่ 1999) — toSatang ต้อง Math.round ให้ถูก
    expect(19.99 * 100).not.toBe(1999); // ยืนยันว่า JS ดิบมีปัญหาจริง (sanity check)
    expect(toSatang(19.99)).toBe(1999);
  });

  it("ตัวเลขทศนิยม 2 ตำแหน่งอื่น ๆ ที่ float มักพัง", () => {
    expect(toSatang(0.1 + 0.2)).toBe(30); // 0.1+0.2 = 0.30000000000000004 ใน JS ดิบ
    expect(toSatang(33.33)).toBe(3333);
    // 1.005*100 = 100.49999999999999 ใน JS ดิบ (ไม่ใช่ 100.5 พอดี) — Math.round ได้ 100 ตามค่าจริงที่
    //เก็บได้ใน IEEE754 double ไม่ใช่ 101 (นี่คือพฤติกรรมที่ถูกต้องของ Math.round ไม่ใช่บั๊ก — แค่ยืนยันว่า
    // toSatang ไม่ทำอะไรพิเศษเกินกว่า Math.round ธรรมดา)
    expect(toSatang(1.005)).toBe(100);
  });

  it("toBaht กลับด้านถูกต้อง — ผลลัพธ์ทศนิยม 2 ตำแหน่งเสมอ ไม่มีเศษ float ค้าง", () => {
    expect(toBaht(10000)).toBe(100);
    expect(toBaht(1999)).toBe(19.99);
    expect(toBaht(0)).toBe(0);
    expect(toBaht(1)).toBe(0.01);
  });

  it("toSatang → toBaht round-trip ไม่เพี้ยนสำหรับค่าเงินทั่วไป", () => {
    for (const baht of [0, 1, 9.99, 19.99, 100, 123.45, 999.99, 1500, 33.33]) {
      expect(toBaht(toSatang(baht))).toBeCloseTo(baht, 10);
    }
  });
});

describe("money.percentOfSatang", () => {
  it("คิดเปอร์เซ็นต์ของยอดสตางค์แล้วปัดเป็น integer เสมอ", () => {
    expect(percentOfSatang(10000, 15)).toBe(1500); // 15% ของ 100 บาท = 15 บาท = 1500 สตางค์
    expect(percentOfSatang(9999, 10)).toBe(1000); // 999.9 ปัดเป็น 1000
  });
});

describe("money.toSatangFields / toBahtFields", () => {
  it("แปลงเฉพาะ key ที่ระบุ ข้าม null/undefined และ field อื่นที่ไม่ใช่ตัวเลข", () => {
    const input = { subtotal: 100, discount_amount: null, note: "x", total_amount: 80 };
    const out = toSatangFields(input, ["subtotal", "discount_amount", "total_amount"] as const);
    expect(out).toEqual({ subtotal: 10000, discount_amount: null, note: "x", total_amount: 8000 });
  });

  it("toBahtFields แปลงกลับถูกต้อง ไม่แก้ object เดิม (คืน object ใหม่)", () => {
    const input = { subtotal: 10000, total_amount: 8000 };
    const out = toBahtFields(input, ["subtotal", "total_amount"] as const);
    expect(out).toEqual({ subtotal: 100, total_amount: 80 });
    expect(input).toEqual({ subtotal: 10000, total_amount: 8000 }); // ต้นฉบับไม่ถูกแก้
  });
});
