// ─────────────────────────────────────────────────────────────
// src/i18n/request.ts
// next-intl v4 — เรียกทุก request ฝั่ง server เพื่อสร้าง config (locale + messages)
// ผูกเข้ากับ Next ผ่าน createNextIntlPlugin ใน next.config.ts
// locale อ่านจาก cookie LOCALE_COOKIE (ไม่มี i18n routing) → ไม่มี → defaultLocale
// ─────────────────────────────────────────────────────────────
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return {
    locale,
    messages: (await import(`@/i18n/messages/${locale}.json`)).default,
  };
});
