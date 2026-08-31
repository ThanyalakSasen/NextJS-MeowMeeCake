"use client";

// ─────────────────────────────────────────────────────────────
// src/i18n/useSetLocale.ts
// hook สลับภาษา (client) — เขียน cookie LOCALE_COOKIE แล้ว refresh
// ให้ server components + request.ts อ่าน locale ใหม่
// ─────────────────────────────────────────────────────────────
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function useSetLocale() {
  const router = useRouter();
  const current = useLocale() as Locale;
  const [isPending, startTransition] = useTransition();

  function setLocale(next: Locale) {
    if (next === current) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return { locale: current, setLocale, isPending };
}
