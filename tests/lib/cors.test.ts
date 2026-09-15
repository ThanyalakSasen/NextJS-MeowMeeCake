import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAllowedOrigin, corsHeaders } from "@/lib/cors";

const ORIGINAL = process.env.ALLOWED_ORIGINS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = ORIGINAL;
});

describe("isAllowedOrigin", () => {
  it("ไม่ตั้ง ALLOWED_ORIGINS → ไม่มี origin ไหนผ่าน", () => {
    delete process.env.ALLOWED_ORIGINS;
    expect(isAllowedOrigin("http://localhost:3000")).toBe(false);
  });

  it("origin อยู่ใน allowlist → ผ่าน", () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:3000,https://shop.example.com";
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("https://shop.example.com")).toBe(true);
  });

  it("origin นอก allowlist → ไม่ผ่าน", () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:3000";
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
  });

  it("ไม่มี origin (null) → ไม่ผ่าน", () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:3000";
    expect(isAllowedOrigin(null)).toBe(false);
  });
});

describe("corsHeaders", () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = "http://localhost:3000";
  });

  it("origin ผ่าน allowlist → คืน header ครบ", () => {
    expect(corsHeaders("http://localhost:3000")).toEqual({
      "Access-Control-Allow-Origin": "http://localhost:3000",
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    });
  });

  it("origin ไม่ผ่าน allowlist → คืน object ว่าง", () => {
    expect(corsHeaders("https://evil.com")).toEqual({});
  });

  it("ไม่มี origin → คืน object ว่าง", () => {
    expect(corsHeaders(null)).toEqual({});
  });
});
