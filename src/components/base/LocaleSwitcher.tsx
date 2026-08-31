"use client";

// ─────────────────────────────────────────────────────────────
// src/components/base/LocaleSwitcher.tsx
// ปุ่มสลับภาษา TH / EN — เขียน cookie แล้ว refresh (ผ่าน useSetLocale)
// เฟส 3: Navbar จะ mount ตัวนี้ไว้มุมขวา
// ─────────────────────────────────────────────────────────────
import { locales, localeNames } from "@/i18n/config";
import { useSetLocale } from "@/i18n/useSetLocale";

export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, isPending } = useSetLocale();

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg border border-brown-200 p-0.5 ${className}`}
      role="group"
      aria-label="Language"
    >
      {locales.map((code) => (
        <button
          key={code}
          type="button"
          disabled={isPending}
          onClick={() => setLocale(code)}
          aria-pressed={locale === code}
          className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
            locale === code
              ? "bg-brown-800 text-white"
              : "text-brown-700 hover:bg-brown-50"
          } ${isPending ? "opacity-60" : ""}`}
        >
          {localeNames[code]}
        </button>
      ))}
    </div>
  );
}
