/**
 * cors — allowlist origin สำหรับกรณี frontend แยก origin จริง (ดู docs/security-hardening.md §3)
 *
 * ตั้งค่า ALLOWED_ORIGINS ใน .env.local เป็น comma-separated list เช่น
 *   ALLOWED_ORIGINS=http://localhost:3000,https://shop.meowmeecake.com
 * ไม่ตั้ง (ค่าว่าง/ไม่มี) = ไม่มี origin ไหนผ่าน cross-origin ได้ (พฤติกรรมเดิม: same-origin only)
 *
 * ใช้ร่วมกับ isCsrfSafe (src/lib/csrf.ts — origin ใน allowlist นับเป็น "ปลอดภัย" ด้วย)
 * และ middleware.ts (แนบ header ตอบ preflight + response จริง)
 */
function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return allowedOrigins().includes(origin);
}

/** header สำหรับแนบลง response — ว่างเปล่าถ้า origin ไม่อยู่ใน allowlist (หรือไม่มี Origin) */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}
