import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, __resetRateLimit } from "@/lib/rateLimit";
import { isHttpError } from "@/lib/httpError";

// unit project ตั้ง RATE_LIMIT_STORE=memory (vitest.config.mts) — ที่เก็บแบบ mongo เทสใน tests/integration/sharedState.test.ts
beforeEach(() => __resetRateLimit());

const opt = { limit: 3, windowMs: 1000 };

describe("rateLimit (memory store)", () => {
  it("อนุญาตจนถึง limit แล้ว throw HttpError 429", async () => {
    for (let i = 0; i < 3; i++) await rateLimit("1.1.1.1", "t", opt);
    try {
      await rateLimit("1.1.1.1", "t", opt);
      throw new Error("should have thrown");
    } catch (e) {
      expect(isHttpError(e)).toBe(true);
      expect((e as { status: number }).status).toBe(429);
      expect((e as { details: { retry_after_seconds: number } }).details.retry_after_seconds).toBeGreaterThan(0);
    }
  });

  it("ip = null → ไม่จำกัด", async () => {
    for (let i = 0; i < 50; i++) await rateLimit(null, "t", { limit: 1, windowMs: 1000 });
    expect(true).toBe(true);
  });

  it("แยก bucket ตาม ip + scope", async () => {
    await rateLimit("a", "s1", { limit: 1, windowMs: 1000 });
    await expect(rateLimit("b", "s1", { limit: 1, windowMs: 1000 })).resolves.toBeUndefined();
    await expect(rateLimit("a", "s2", { limit: 1, windowMs: 1000 })).resolves.toBeUndefined();
    await expect(rateLimit("a", "s1", { limit: 1, windowMs: 1000 })).rejects.toThrow();
  });

  it("sliding window: หลังพ้น windowMs นับใหม่", async () => {
    await rateLimit("x", "s", { limit: 1, windowMs: 30 });
    await expect(rateLimit("x", "s", { limit: 1, windowMs: 30 })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 45));
    await expect(rateLimit("x", "s", { limit: 1, windowMs: 30 })).resolves.toBeUndefined();
  });
});
