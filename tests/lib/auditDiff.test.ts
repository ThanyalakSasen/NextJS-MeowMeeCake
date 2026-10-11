import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { diffFields, docLabel, normalize, snapshot } from "@/lib/auditDiff";

describe("lib/auditDiff — ก่อน/หลังของ UserLog", () => {
  it("เก็บเฉพาะฟิลด์ที่เปลี่ยน (โปรโมชันลด 20 → 50)", () => {
    const before = { _id: "p1", promotion_name: "ลดหน้าร้อน", discount_value: 20, is_active: true };
    const after = { ...before, discount_value: 50, updated_at: new Date() };
    expect(diffFields(before, after, ["discount_value", "is_active"])).toEqual({
      before: { discount_value: 20 },
      after: { discount_value: 50 },
    });
  });

  it("ไม่มีอะไรเปลี่ยน → null · คีย์ที่ไม่มีทั้งสองฝั่งถูกข้าม", () => {
    expect(diffFields({ a: 1 }, { a: 1 }, ["a", "ghost"])).toBeNull();
  });

  it("ไม่บันทึกฟิลด์ลับและฟิลด์ระบบ", () => {
    const d = diffFields(
      { password: "x", reset_password_token: "a", updated_at: "1", user_fullname: "ก" },
      { password: "y", reset_password_token: "b", updated_at: "2", user_fullname: "ข" },
    );
    expect(d).toEqual({ before: { user_fullname: "ก" }, after: { user_fullname: "ข" } });
  });

  it("ref ที่ populate แล้วเทียบด้วยชื่อ · ObjectId/Date เป็น string", () => {
    const id = new mongoose.Types.ObjectId();
    expect(normalize({ _id: id, unit_name: "กิโลกรัม" })).toBe("กิโลกรัม");
    expect(normalize(id)).toBe(String(id));
    expect(normalize(new Date("2026-01-02T00:00:00Z"))).toBe("2026-01-02T00:00:00.000Z");
  });

  it("docLabel เลือกชื่อของรายการ", () => {
    expect(docLabel({ product_name_th: "ขนมปัง", product_name_eng: "Bread" })).toBe("ขนมปัง");
    expect(docLabel({ ingredient_category_name: "แป้ง" })).toBe("แป้ง");
    expect(docLabel({ qty: 1 })).toBeUndefined();
  });

  it("object ซ้อน → ชื่อฟิลด์แบบจุด (social_links.facebook)", () => {
    expect(
      diffFields({ social_links: { facebook: "a", line: "x" } }, { social_links: { facebook: "b", line: "x" } }, ["social_links"]),
    ).toEqual({ before: { "social_links.facebook": "a" }, after: { "social_links.facebook": "b" } });
  });

  it("รายการที่มีชื่อต่อแถว → เทียบรายแถว · แถวใหม่/ถูกลบ = อีกฝั่งเป็น null", () => {
    const id1 = new mongoose.Types.ObjectId();
    const row = (name: string, close: string) => ({
      _id: id1, name, location: "", days: ["sat"], open_time: "17:00", close_time: close, map_url: "", is_active: true,
    });
    const d = diffFields(
      { weekly_markets: [row("ตลาดเช้า", "22:00"), row("ตลาดเย็น", "21:00")] },
      { weekly_markets: [row("ตลาดเช้า", "23:00"), row("ถนนคนเดิน", "21:00")] },
      ["weekly_markets"],
    )!;
    expect(d.before["weekly_markets[ตลาดเช้า].close_time"]).toBe("22:00");
    expect(d.after["weekly_markets[ตลาดเช้า].close_time"]).toBe("23:00");
    expect(d.after["weekly_markets[ตลาดเย็น]"]).toBeNull();
    expect(d.before["weekly_markets[ถนนคนเดิน]"]).toBeNull();
    expect((d.after["weekly_markets[ถนนคนเดิน]"] as { close_time: string }).close_time).toBe("21:00");
  });

  it("เลขออเดอร์เป็นชื่อของรายการ", () => {
    expect(docLabel({ order_no: "ORD-001", order_status: "pending" })).toBe("ORD-001");
  });

  it("snapshot จำกัดตาม keys", () => {
    expect(snapshot({ _id: "1", promotion_name: "A", discount_value: 20, x: 1 }, ["promotion_name", "discount_value"]))
      .toEqual({ promotion_name: "A", discount_value: 20 });
  });
});
