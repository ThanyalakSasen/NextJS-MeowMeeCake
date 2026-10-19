/**
 * rateLimit — sliding-window limiter ที่แชร์ข้าม instance (BACKLOG5 G6)
 *
 *   await rateLimit(clientIp(req), "auth:login", { limit: 10, windowMs: 60_000 });
 *
 * - นับ 1 ครั้งต่อการเรียก · เกิน limit ใน windowMs → throw HttpError 429 (คำขอที่ถูกปฏิเสธไม่นับเพิ่ม)
 * - key = `${ip}:${scope}` · ip = null (หา IP ไม่เจอ) → ข้าม (ไม่จำกัด)
 * - ที่เก็บ (env `RATE_LIMIT_STORE`):
 *     "mongo" (ค่าเริ่มต้น) — collection RateLimits อัปเดตแบบ atomic (update pipeline ครั้งเดียว) → ทุก instance นับรวมกัน
 *                            · TTL index ลบ key ที่หมดอายุเอง
 *     "memory"             — Map ในหน่วยความจำ (ต่อ instance) ใช้ใน unit test ที่ไม่มี DB
 * - DB ใช้ไม่ได้ชั่วคราว → นับในหน่วยความจำแทน (ยังกันได้ต่อ instance ไม่เปิดโล่ง และไม่บล็อกผู้ใช้เพราะ DB ล่ม)
 * - ใช้คู่กับ account-lockout ใน authService (ต่อบัญชี) — คนละชั้นกัน (อันนี้ต่อ IP)
 */
import dbConnect from "./dbConnect";
import { tooMany } from "./httpError";
import { log } from "./logger";
import RateLimitModel from "../models/rateLimitModel";

export interface RateLimitOptions {
  /** จำนวนครั้งสูงสุดใน window */
  limit: number;
  /** ขนาด window (ms) */
  windowMs: number;
}

/** ผลการนับ: ผ่านไหม + คำขอเก่าสุดใน window (ใช้คำนวณเวลารอ) */
interface HitResult {
  allowed: boolean;
  oldest: number;
}

function isMemoryStore(): boolean {
  return process.env.RATE_LIMIT_STORE?.trim().toLowerCase() === "memory";
}

// ── ที่เก็บในหน่วยความจำ (unit test / สำรองตอน DB ใช้ไม่ได้) ──
const memory = new Map<string, number[]>();
let lastSweep = 0;

/** ล้าง key ที่ไม่มีคำขอเกิน 1 ชม. ทุก ๆ ~1 นาที กัน Map โตไม่จำกัด */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, hits] of memory) {
    if (hits.length === 0 || now - hits[hits.length - 1] > 3_600_000) memory.delete(key);
  }
}

function memoryHit(key: string, now: number, opts: RateLimitOptions): HitResult {
  sweep(now);
  const hits = (memory.get(key) ?? []).filter((t) => now - t < opts.windowMs);
  const allowed = hits.length < opts.limit;
  if (allowed) hits.push(now);
  memory.set(key, hits);
  return { allowed, oldest: hits[0] ?? now };
}

// ── ที่เก็บใน MongoDB ────────────────────────────────────────
async function mongoHit(key: string, now: number, opts: RateLimitOptions): Promise<HitResult> {
  await dbConnect();
  const windowStart = now - opts.windowMs;
  const expireAt = new Date(now + opts.windowMs);
  // ตัดคำขอที่พ้น window → ยังไม่ถึง limit ค่อยเพิ่มคำขอนี้ — ทั้งหมดใน update เดียว (atomic ต่อเอกสาร)
  const doc = await RateLimitModel.collection.findOneAndUpdate(
    { _id: key as never },
    [
      {
        $set: {
          hits: {
            $filter: { input: { $ifNull: ["$hits", []] }, cond: { $gt: ["$$this", windowStart] } },
          },
        },
      },
      { $set: { allowed: { $lt: [{ $size: "$hits" }, opts.limit] } } },
      {
        $set: {
          hits: { $cond: ["$allowed", { $concatArrays: ["$hits", [now]] }, "$hits"] },
          expire_at: { $cond: ["$allowed", expireAt, { $ifNull: ["$expire_at", expireAt] }] },
        },
      },
    ],
    { upsert: true, returnDocument: "after" }
  );
  const hits = (doc?.hits as number[] | undefined) ?? [];
  return { allowed: doc?.allowed !== false, oldest: hits[0] ?? now };
}

export async function rateLimit(ip: string | null, scope: string, opts: RateLimitOptions): Promise<void> {
  if (!ip) return;

  const now = Date.now();
  const key = `${ip}:${scope}`;

  let result: HitResult;
  if (isMemoryStore()) {
    result = memoryHit(key, now, opts);
  } else {
    try {
      result = await mongoHit(key, now, opts);
    } catch (err) {
      log.warn("rate_limit.store_failed", { scope, err });
      result = memoryHit(key, now, opts);
    }
  }

  if (!result.allowed) {
    const retryMs = opts.windowMs - (now - result.oldest);
    const seconds = Math.max(1, Math.ceil(retryMs / 1000));
    throw tooMany(`คำขอถี่เกินไป กรุณาลองใหม่ในอีก ${seconds} วินาที`, {
      retry_after_seconds: seconds,
    });
  }
}

/** สำหรับเทส — เคลียร์สถานะทั้งหมด (หน่วยความจำ + collection เมื่อใช้ mongo) */
export async function __resetRateLimit(): Promise<void> {
  memory.clear();
  lastSweep = 0;
  if (isMemoryStore()) return;
  try {
    await dbConnect();
    await RateLimitModel.deleteMany({});
  } catch {
    // ไม่มี DB (เช่น unit test) — หน่วยความจำล้างแล้วพอ
  }
}
