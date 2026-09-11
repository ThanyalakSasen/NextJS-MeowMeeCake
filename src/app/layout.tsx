import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "MeowMeeCake API",
  description: "Backend API สำหรับร้าน MeowMeeCake",
};

// root layout ขั้นต่ำ — โปรเจกต์นี้เน้นฝั่ง API (src/app/api/**) ยังไม่มีหน้าเว็บจริง
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
