import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl แบบไม่มี i18n routing — locale อ่านจาก cookie ใน src/i18n/request.ts
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // เปิด React Compiler ให้ตรงกับต้นทาง (D3) — ต้องมี babel-plugin-react-compiler ใน devDependencies
  reactCompiler: true,
};

export default withNextIntl(nextConfig);
