import type { NextRequest } from "next/server";

/** IP ของ client จาก header ที่ proxy แนบมา (nginx ตั้งทับ X-Forwarded-For ด้วย $remote_addr — DEPLOY ⑥) */
export function clientIpFromHeaders(get: (name: string) => string | null | undefined): string | null {
  const fwd = get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return get("x-real-ip") || null;
}

/** ดึง IP ของ client จาก header ที่ proxy/แพลตฟอร์มแนบมา (best-effort) */
export function clientIp(req: NextRequest): string | null {
  return clientIpFromHeaders((name) => req.headers.get(name));
}
