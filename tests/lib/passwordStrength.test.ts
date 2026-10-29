import { describe, it, expect } from "vitest";
import { assertPasswordStrength } from "@/services/userService";

describe("assertPasswordStrength", () => {
  it("ช่องว่างล้วนไม่ผ่าน แม้ยาวพอ", () => {
    expect(() => assertPasswordStrength(" ".repeat(12))).toThrow(/ช่องว่างล้วน/);
    expect(() => assertPasswordStrength("\t \n ".repeat(4))).toThrow(/ช่องว่างล้วน/);
  });
  it("สั้นเกินยังไม่ผ่าน · รหัสปกติ (มีช่องว่างปนได้) ผ่าน", () => {
    expect(() => assertPasswordStrength("ab")).toThrow(/อย่างน้อย/);
    expect(() => assertPasswordStrength("cake lover 2026")).not.toThrow();
  });
});
