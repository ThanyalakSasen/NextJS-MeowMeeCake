/**
 * rateLimit — in-memory sliding-window limiter (best-effort, ต่อ instance)
 *
 *   rateLimit(clientIp(req), "auth:login", { limit: 10, windowMs: 60_000 });
 *
 * - นับ 1 ครั้งต่อการเรียก · เกิน limit ใน windowMs → throw HttpError 429
 * - key = `${ip}:${scope}` · ip = null (หา IP ไม่เจอ) → ข้าม (ไม่จำกัด)
 * - เก็บใน Map ในหน่วยความจำ → รีเซ็ตเมื่อ restart / ไม่ share ข้าม instance
 *   ถ้ามีหลาย instance / serverless ให้เปลี่ยน backend เป็น Redis (แก้เฉพาะไฟล์นี้)
 * - ใช้คู่กับ account-lockout ใน authService (ต่อบัญชี) — คนละชั้นกัน (อันนี้ต่อ IP)
 */
import { tooMany } from "./httpError";

interface Bucket {
  hits: number[];
}

const store = new Map<string, Bucket>();
let lastSweep = 0;

/** ล้าง bucket ที่หมดอายุทุก ๆ ~1 นาที กัน Map โตไม่จำกัด */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of store) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > 3_600_000) {
      store.delete(key);
    }
  }
}

export interface RateLimitOptions {
  /** จำนวนครั้งสูงสุดใน window */
  limit: number;
  /** ขนาด window (ms) */
  windowMs: number;
}

export function rateLimit(ip: string | null, scope: string, opts: RateLimitOptions): void {
  if (!ip) return;

  const now = Date.now();
  sweep(now);

  const key = `${ip}:${scope}`;
  const bucket = store.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < opts.windowMs);

  if (bucket.hits.length >= opts.limit) {
    const retryMs = opts.windowMs - (now - bucket.hits[0]);
    const seconds = Math.max(1, Math.ceil(retryMs / 1000));
    store.set(key, bucket);
    throw tooMany(`คำขอถี่เกินไป กรุณาลองใหม่ในอีก ${seconds} วินาที`, {
      retry_after_seconds: seconds,
    });
  }

  bucket.hits.push(now);
  store.set(key, bucket);
}

/** สำหรับเทส — เคลียร์สถานะทั้งหมด */
export function __resetRateLimit(): void {
  store.clear();
  lastSweep = 0;
}
