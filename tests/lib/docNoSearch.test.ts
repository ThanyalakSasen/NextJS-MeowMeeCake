import { describe, it, expect } from "vitest";
import { docNoSearchRegExp } from "@/lib/docNoSearch";

/** ค้นรหัสท้ายเลขบิลจากหน้าประวัติของลูกค้า (lib/docNoSearch.ts) */
describe("docNoSearchRegExp", () => {
  it("รหัสท้าย (MMC004) ตรงกับเลขบิลนั้น · ไม่สนตัวพิมพ์เล็ก/ใหญ่", () => {
    expect(docNoSearchRegExp("MMC004").test("ORD-20261024-MMC004")).toBe(true);
    expect(docNoSearchRegExp("mmc004").test("PRE-20261024-MMC004")).toBe(true);
  });
  it("ตัวเลขไม่ไปตรงกับวันที่ในเลขบิล", () => {
    expect(docNoSearchRegExp("004").test("ORD-20261004-MMC012")).toBe(false);
    expect(docNoSearchRegExp("004").test("ORD-20261024-MMC004")).toBe(true);
  });
  it("พิมพ์เลขที่มีขีด = ค้นทั้งเลข", () => {
    expect(docNoSearchRegExp("20261024-MMC").test("ORD-20261024-MMC004")).toBe(true);
  });
});
