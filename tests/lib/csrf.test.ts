import { describe, it, expect } from "vitest";
import { isCsrfSafe } from "@/lib/csrf";

const HOST = "shop.example.com";

describe("isCsrfSafe", () => {
  it("safe method → ผ่านเสมอ (ไม่สน Origin)", () => {
    expect(isCsrfSafe("GET", "https://evil.com", HOST)).toBe(true);
    expect(isCsrfSafe("head", null, HOST)).toBe(true);
    expect(isCsrfSafe("OPTIONS", "https://evil.com", HOST)).toBe(true);
  });

  it("mutation ไม่มี Origin → ผ่าน (non-browser client)", () => {
    expect(isCsrfSafe("POST", null, HOST)).toBe(true);
    expect(isCsrfSafe("DELETE", null, HOST)).toBe(true);
  });

  it("mutation same-origin → ผ่าน", () => {
    expect(isCsrfSafe("POST", `https://${HOST}`, HOST)).toBe(true);
    expect(isCsrfSafe("PATCH", `http://${HOST}`, HOST)).toBe(true);
  });

  it("mutation cross-origin → ปฏิเสธ", () => {
    expect(isCsrfSafe("POST", "https://evil.com", HOST)).toBe(false);
    expect(isCsrfSafe("PUT", `https://sub.${HOST}`, HOST)).toBe(false);
  });

  it("Origin เพี้ยน / 'null' → ปฏิเสธ", () => {
    expect(isCsrfSafe("POST", "null", HOST)).toBe(false);
    expect(isCsrfSafe("POST", "not a url", HOST)).toBe(false);
  });
});
