import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ให้ mongoose ถูก bundle แบบ external ใน server runtime (เลี่ยงปัญหา build กับ native/dynamic require)
  serverExternalPackages: ["mongoose", "bcryptjs"],
};

export default nextConfig;
