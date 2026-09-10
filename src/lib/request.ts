import type { NextRequest } from "next/server";

/** ดึง IP ของ client จาก header ที่ proxy/แพลตฟอร์มแนบมา (best-effort) */
export function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}
