import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "@/app/globals.css";
import Providers from "@/app/providers";

export const metadata: Metadata = {
  title: "MeowMee Cake",
  description: "ระบบจัดการร้าน MeowMee Cake",
};

// Root layout — ไม่มี Sidebar/Navbar
// inject globals.css, ครอบ NextIntlClientProvider (i18n) + antd ConfigProvider (Providers)
// locale มาจาก cookie ผ่าน src/i18n/request.ts (ไม่มี /th /en ใน URL)
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
