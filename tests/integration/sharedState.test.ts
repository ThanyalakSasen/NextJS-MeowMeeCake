import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import RateLimitModel from "@/models/rateLimitModel";
import LineQuotaStateModel from "@/models/lineQuotaStateModel";
import { createSharedCache } from "@/lib/sharedCache";

/**
 * BACKLOG5 G6 — state ที่เคยอยู่ในหน่วยความจำต่อ instance ย้ายไปแชร์ผ่าน MongoDB
 *   - rateLimit: ตัวนับใน RateLimits
 *   - sharedCache: cache ในหน่วยความจำ + เลขเวอร์ชันใน CacheVersions (ล้างข้าม instance)
 *   - lineQuota: ตัวเลขโควตาใน LineQuotaStates
 * "instance อื่น" จำลองด้วย vi.resetModules() แล้ว import module ใหม่ (state ในหน่วยความจำเริ่มใหม่ · DB เดิม)
 */

type RateLimitModule = typeof import("@/lib/rateLimit");

async function freshRateLimit(): Promise<RateLimitModule> {
  vi.resetModules();
  return import("@/lib/rateLimit");
}

describe("rateLimit — ที่เก็บ mongo (ค่าเริ่มต้น)", () => {
  it("instance อื่นนับรวมกัน: A ใช้ครบ limit → B ถูกปฏิเสธ", async () => {
    const a = await freshRateLimit();
    const opt = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) await a.rateLimit("203.0.113.1", "t", opt);

    const b = await freshRateLimit();
    await expect(b.rateLimit("203.0.113.1", "t", opt)).rejects.toThrow(/คำขอถี่เกินไป/);
    // IP อื่นไม่โดน
    await expect(b.rateLimit("203.0.113.2", "t", opt)).resolves.toBeUndefined();
  });

  it("คำขอพร้อมกันเกิน limit → ผ่านพอดี limit (atomic)", async () => {
    const { rateLimit } = await freshRateLimit();
    const opt = { limit: 5, windowMs: 60_000 };
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => rateLimit("198.51.100.9", "burst", opt)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const doc = await RateLimitModel.findById("198.51.100.9:burst").lean<{ hits: number[] }>();
    expect(doc?.hits).toHaveLength(5); // คำขอที่ถูกปฏิเสธไม่นับเพิ่ม
  });

  it("sliding window: พ้น windowMs แล้วนับใหม่ · มี expire_at ให้ TTL index ลบเอง", async () => {
    const { rateLimit } = await freshRateLimit();
    await rateLimit("192.0.2.5", "slide", { limit: 1, windowMs: 40 });
    await expect(rateLimit("192.0.2.5", "slide", { limit: 1, windowMs: 40 })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 60));
    await expect(rateLimit("192.0.2.5", "slide", { limit: 1, windowMs: 40 })).resolves.toBeUndefined();

    const doc = await RateLimitModel.findById("192.0.2.5:slide").lean<{ expire_at: Date }>();
    expect(doc?.expire_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("retry_after_seconds คิดจากคำขอเก่าสุดใน window", async () => {
    const { rateLimit } = await freshRateLimit();
    await rateLimit("192.0.2.6", "retry", { limit: 1, windowMs: 30_000 });
    try {
      await rateLimit("192.0.2.6", "retry", { limit: 1, windowMs: 30_000 });
      throw new Error("should have thrown");
    } catch (e) {
      const seconds = (e as { details: { retry_after_seconds: number } }).details.retry_after_seconds;
      expect(seconds).toBeGreaterThan(25);
      expect(seconds).toBeLessThanOrEqual(30);
    }
  });
});

describe("sharedCache — ล้าง cache ข้าม instance", () => {
  beforeEach(() => {
    process.env.SHARED_CACHE_SYNC_MS = "0"; // ถามเลขเวอร์ชันทุกครั้ง — เทสไม่ต้องรอ 2 วิ
  });
  afterEach(() => {
    delete process.env.SHARED_CACHE_SYNC_MS;
  });

  it("cache ทำงาน: โหลดครั้งเดียวจนกว่าจะ invalidate", async () => {
    const cache = createSharedCache<number>("t_basic", () => 60_000);
    const loader = vi.fn(async () => 1);
    await cache.getOrLoad("k", loader);
    await cache.getOrLoad("k", loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("instance A invalidate → instance B ทิ้ง cache แล้วโหลดใหม่", async () => {
    // cache ชื่อเดียวกัน 2 ตัว = 2 instance (หน่วยความจำแยก · CacheVersions ร่วม)
    const a = createSharedCache<string>("t_cross", () => 60_000);
    const b = createSharedCache<string>("t_cross", () => 60_000);
    let value = "old";
    const load = async () => value;

    expect(await b.getOrLoad("k", load)).toBe("old");
    value = "new";
    expect(await b.getOrLoad("k", load)).toBe("old"); // ยังเป็น cache

    await a.invalidate();
    expect(await b.getOrLoad("k", load)).toBe("new");
  });

  it("SHARED_CACHE_SYNC_MS: ภายในช่วงนี้ไม่ถามเลขเวอร์ชันใหม่ (instance อื่นเห็นช้าได้ไม่เกินช่วงนี้)", async () => {
    process.env.SHARED_CACHE_SYNC_MS = "60000";
    const a = createSharedCache<string>("t_sync", () => 60_000);
    const b = createSharedCache<string>("t_sync", () => 60_000);
    let value = "old";
    const load = async () => value;
    await b.getOrLoad("k", load);
    value = "new";
    await a.invalidate();
    expect(await b.getOrLoad("k", load)).toBe("old");
    expect(await a.getOrLoad("k", load)).toBe("new"); // instance ที่ invalidate เห็นทันที
  });

  it("TTL = 0 → ไม่ cache", async () => {
    const cache = createSharedCache<number>("t_off", () => 0);
    const loader = vi.fn(async () => 1);
    await cache.getOrLoad("k", loader);
    await cache.getOrLoad("k", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("lineQuota — ตัวเลขโควตาแชร์ข้าม instance", () => {
  beforeEach(() => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "token-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/v2/bot/message/quota")) return { ok: true, json: async () => ({ type: "limited", value: 300 }) };
        return { ok: true, json: async () => ({ totalUsage: 100 }) };
      })
    );
  });
  afterEach(() => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    vi.unstubAllGlobals();
  });

  it("instance A ส่งสำเร็จ (recordPushed) → instance B เห็นโควตาที่หักแล้ว โดยไม่ถาม LINE ใหม่", async () => {
    vi.resetModules();
    const a = await import("@/lib/lineQuota");
    expect((await a.getQuotaStatus())?.remaining).toBe(200);
    await a.recordPushed();
    await a.recordPushed();

    vi.resetModules();
    const b = await import("@/lib/lineQuota");
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockClear();
    expect(await b.getQuotaStatus()).toEqual({ limit: 300, used: 102, remaining: 198 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("markQuotaExhausted (LINE ตอบ 429) → ทุก instance เห็นเหลือ 0 · recordPushed ไม่ทำให้ติดลบ", async () => {
    vi.resetModules();
    const a = await import("@/lib/lineQuota");
    await a.getQuotaStatus();
    await a.markQuotaExhausted();
    await a.recordPushed();

    vi.resetModules();
    const b = await import("@/lib/lineQuota");
    expect((await b.getQuotaStatus())?.remaining).toBe(0);
    const doc = await LineQuotaStateModel.findById("line_quota").lean<{ remaining: number; used: number }>();
    expect(doc?.remaining).toBe(0);
    expect(doc?.used).toBe(101);
  });
});
