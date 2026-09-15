/**
 * csrf — เกณฑ์ตรวจ CSRF แบบ same-origin + allowlist สำหรับ middleware
 * (defense-in-depth เสริม cookie SameSite=Lax/None ดู src/lib/session.ts)
 */
import { isAllowedOrigin } from "@/lib/cors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * true = คำขอนี้ผ่านเกณฑ์ CSRF:
 *  - method อ่านอย่างเดียว (GET/HEAD/OPTIONS), หรือ
 *  - ไม่มี Origin header (client ที่ไม่ใช่เบราว์เซอร์ — ไม่ใช่ CSRF), หรือ
 *  - Origin host ตรงกับ host ของคำขอ (same-origin), หรือ
 *  - Origin อยู่ใน ALLOWED_ORIGINS allowlist (frontend แยก origin ที่รับรองแล้ว — src/lib/cors.ts)
 * false = mutation ที่มี Origin ข้ามโดเมนนอก allowlist / Origin เพี้ยน ("null")
 */
export function isCsrfSafe(method: string, originHeader: string | null, host: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (!originHeader) return true;
  try {
    if (new URL(originHeader).host === host) return true;
    return isAllowedOrigin(originHeader);
  } catch {
    return false;
  }
}
