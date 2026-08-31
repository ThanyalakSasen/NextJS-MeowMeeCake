import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // เปิด React Compiler ให้ตรงกับต้นทาง (D3) — ต้องมี babel-plugin-react-compiler ใน devDependencies
  reactCompiler: true,
};

export default nextConfig;
