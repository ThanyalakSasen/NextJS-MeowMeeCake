/**
 * sharedCache — cache ในหน่วยความจำ (TTL) ที่ "ล้างพร้อมกันทุก instance" ได้ (BACKLOG5 G6)
 *
 * ค่าที่ cache ยังอยู่ในหน่วยความจำของแต่ละ instance (อ่านเร็ว ไม่ต้อง query) แต่ผูกกับเลขเวอร์ชันใน collection
 * CacheVersions — `invalidate()` เพิ่มเลข → instance อื่นเห็นเลขเปลี่ยนแล้วทิ้ง cache ของตัวเอง
 *
 *   const cache = createSharedCache<Rows>("delivery_zones", () => 60_000);
 *   const rows = await cache.getOrLoad("all", loadRowsFromDb);
 *   await cache.invalidate();            // หลังแก้ข้อมูล
 *
 * - instance ที่เรียก invalidate เห็นผลทันที · instance อื่นเห็นภายใน `SHARED_CACHE_SYNC_MS` (ค่าเริ่มต้น 2000 ms —
 *   ถามเลขเวอร์ชันจาก DB อย่างมากครั้งเดียวต่อช่วงนี้ต่อ cache, เป็น query `_id` เล็ก ๆ)
 * - TTL ≤ 0 → ไม่ cache เลย (โหลดใหม่ทุกครั้ง ไม่แตะ CacheVersions) — ใช้ในเทส
 * - DB ถามเลขเวอร์ชันไม่ได้ → ใช้เลขเดิมที่รู้ (cache ยังหมดอายุตาม TTL ตามปกติ)
 */
import dbConnect from "./dbConnect";
import { log } from "./logger";
import CacheVersionModel from "../models/cacheVersionModel";

interface Entry<T> {
  value: T;
  expiresAt: number;
  version: number;
}

export interface SharedCache<T> {
  /** คืนค่าจาก cache ถ้ายังใช้ได้ ไม่งั้นเรียก loader แล้วเก็บไว้ */
  getOrLoad(key: string, loader: () => Promise<T>): Promise<T>;
  /** ล้าง cache ของทุก instance (เรียกหลังเขียนข้อมูลที่ cache ไว้) */
  invalidate(): Promise<void>;
  /** ล้างเฉพาะหน่วยความจำของ instance นี้ — ใช้ในเทส */
  resetLocal(): void;
}

function syncIntervalMs(): number {
  const n = Number(process.env.SHARED_CACHE_SYNC_MS);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
}

export function createSharedCache<T>(name: string, ttlMs: () => number): SharedCache<T> {
  const entries = new Map<string, Entry<T>>();
  /** เลขเวอร์ชันล่าสุดที่รู้ + เวลาที่ถาม DB ล่าสุด */
  let known = { v: 0, checkedAt: 0 };

  async function currentVersion(): Promise<number> {
    const now = Date.now();
    if (now - known.checkedAt < syncIntervalMs()) return known.v;
    try {
      await dbConnect();
      const doc = await CacheVersionModel.findById(name).select("v").lean<{ v?: number } | null>();
      known = { v: doc?.v ?? 0, checkedAt: now };
    } catch (err) {
      log.warn("shared_cache.version_read_failed", { cache: name, err });
      known = { v: known.v, checkedAt: now };
    }
    return known.v;
  }

  return {
    async getOrLoad(key, loader) {
      const ttl = ttlMs();
      if (ttl <= 0) return loader();

      // อ่านเลขก่อนโหลด — ถ้ามีคน invalidate ระหว่างโหลด ค่าที่เก็บจะมีเลขเก่า แล้วถูกทิ้งรอบถัดไป
      const version = await currentVersion();
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now() && hit.version === version) return hit.value;

      const value = await loader();
      entries.set(key, { value, expiresAt: Date.now() + ttl, version });
      return value;
    },

    async invalidate() {
      entries.clear();
      if (ttlMs() <= 0) return;
      try {
        await dbConnect();
        const doc = await CacheVersionModel.findOneAndUpdate(
          { _id: name },
          { $inc: { v: 1 } },
          { upsert: true, returnDocument: "after" }
        ).lean<{ v: number } | null>();
        known = { v: doc?.v ?? known.v + 1, checkedAt: Date.now() };
      } catch (err) {
        // instance อื่นจะเห็นค่าใหม่เมื่อ TTL หมดอายุ (เหมือนก่อนมี sharedCache)
        log.warn("shared_cache.invalidate_failed", { cache: name, err });
      }
    },

    resetLocal() {
      entries.clear();
      known = { v: 0, checkedAt: 0 };
    },
  };
}
