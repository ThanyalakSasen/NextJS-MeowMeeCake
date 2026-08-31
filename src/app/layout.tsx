import type { Metadata } from "next";
import "@/app/globals.css";
import Providers from "@/app/providers";

export const metadata: Metadata = {
  title: "MeowMee Cake",
  description: "ระบบจัดการร้าน MeowMee Cake",
};

// Root layout — ไม่มี Sidebar/Navbar
// ทำหน้าที่ inject globals.css, ครอบ antd ConfigProvider (Providers) และ <html><body>
// เฟส 0.5 จะเพิ่ม NextIntlClientProvider + <html lang> แบบ dynamic
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
