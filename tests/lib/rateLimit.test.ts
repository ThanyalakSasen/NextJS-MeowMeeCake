import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, __resetRateLimit } from "@/lib/rateLimit";
import { isHttpError } from "@/lib/httpError";

beforeEach(() => __resetRateLimit());

const opt = { limit: 3, windowMs: 1000 };

describe("rateLimit", () => {
  it("อนุญาตจนถึง limit แล้ว throw HttpError 429", () => {
    for (let i = 0; i < 3; i++) rateLimit("1.1.1.1", "t", opt);
    try {
      rateLimit("1.1.1.1", "t", opt);
      throw new Error("should have thrown");
    } catch (e) {
      expect(isHttpError(e)).toBe(true);
      expect((e as { status: number }).status).toBe(429);
      expect((e as { details: { retry_after_seconds: number } }).details.retry_after_seconds).toBeGreaterThan(0);
    }
  });

  it("ip = null → ไม่จำกัด", () => {
    for (let i = 0; i < 50; i++) rateLimit(null, "t", { limit: 1, windowMs: 1000 });
    expect(true).toBe(true);
  });

  it("แยก bucket ตาม ip + scope", () => {
    rateLimit("a", "s1", { limit: 1, windowMs: 1000 });
    expect(() => rateLimit("b", "s1", { limit: 1, windowMs: 1000 })).not.toThrow();
    expect(() => rateLimit("a", "s2", { limit: 1, windowMs: 1000 })).not.toThrow();
    expect(() => rateLimit("a", "s1", { limit: 1, windowMs: 1000 })).toThrow();
  });

  it("sliding window: หลังพ้น windowMs นับใหม่", async () => {
    rateLimit("x", "s", { limit: 1, windowMs: 30 });
    expect(() => rateLimit("x", "s", { limit: 1, windowMs: 30 })).toThrow();
    await new Promise((r) => setTimeout(r, 45));
    expect(() => rateLimit("x", "s", { limit: 1, windowMs: 30 })).not.toThrow();
  });
});
