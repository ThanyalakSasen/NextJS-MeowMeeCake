/**
 * csrf — เกณฑ์ตรวจ CSRF แบบ same-origin สำหรับ middleware (defense-in-depth เสริม cookie SameSite=Lax)
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * true = คำขอนี้ผ่านเกณฑ์ CSRF:
 *  - method อ่านอย่างเดียว (GET/HEAD/OPTIONS), หรือ
 *  - ไม่มี Origin header (client ที่ไม่ใช่เบราว์เซอร์ — ไม่ใช่ CSRF), หรือ
 *  - Origin host ตรงกับ host ของคำขอ (same-origin)
 * false = mutation ที่มี Origin ข้ามโดเมน / Origin เพี้ยน ("null")
 */
export function isCsrfSafe(method: string, originHeader: string | null, host: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (!originHeader) return true;
  try {
    return new URL(originHeader).host === host;
  } catch {
    return false;
  }
}
