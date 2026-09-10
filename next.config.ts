import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ให้ mongoose ถูก bundle แบบ external ใน server runtime (เลี่ยงปัญหา build กับ native/dynamic require)
  serverExternalPackages: ["mongoose", "bcryptjs"],

  // ชั่วคราว: repo นี้ไม่เคย lint มาก่อน มี warning ค้างสะสม — ไม่ให้ `next build` แดงจาก lint
  // รัน `npm run lint` แยก แล้วทยอยเก็บ → เมื่อสะอาดแล้วให้ลบบรรทัดนี้ (ดู docs/infra-tooling.md §1)
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
