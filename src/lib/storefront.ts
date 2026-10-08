/**
 * URL หน้าเว็บลูกค้า — ใช้ประกอบลิงก์ที่ส่งออกนอกเว็บ (อีเมล · ข้อความ LINE)
 * STOREFRONT_URL (ไม่ตั้ง = ใช้ NEXTAUTH_URL) — docs/env.md
 */

/** base URL ไม่มี / ปิดท้าย · ไม่ได้ตั้งทั้งคู่ = "" */
export function storefrontBase(): string {
  return (process.env.STOREFRONT_URL || process.env.NEXTAUTH_URL || "").trim().replace(/\/+$/, "");
}

/** URL เต็มของ path ในหน้าเว็บลูกค้า */
export function storefrontUrl(path: string): string {
  return `${storefrontBase()}${path}`;
}
