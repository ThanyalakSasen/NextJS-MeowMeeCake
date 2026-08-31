// ─────────────────────────────────────────────────────────────
// src/i18n/config.ts
// ค่าคงที่ i18n — pure, import ได้ทั้ง client/server/proxy
// รูปแบบ: next-intl v4 แบบ "ไม่มี i18n routing" (locale เก็บใน cookie ไม่มี /th /en ใน URL)
// ─────────────────────────────────────────────────────────────

export const locales = ["th", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "th";

/** ชื่อภาษาในภาษาของตัวเอง (endonym) — ใช้บนปุ่มสลับภาษา ไม่แปลตาม locale ปัจจุบัน */
export const localeNames: Record<Locale, string> = { th: "ไทย", en: "EN" };

/** cookie ที่เก็บภาษาที่ผู้ใช้เลือก — อ่านใน src/i18n/request.ts, เขียนใน useSetLocale / proxy */
export const LOCALE_COOKIE = "mmc_locale";

/** ปี Buddhist Era (พ.ศ.) offset — ใช้ตอน format วันที่ภาษาไทย */
export const BE_OFFSET = 543;

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

export function resolveLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : defaultLocale;
}
