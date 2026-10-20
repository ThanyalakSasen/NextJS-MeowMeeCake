/**
 * /api/cron/storage-cleanup — ลบไฟล์ใน R2 ที่ไม่มีข้อมูลใน DB อ้างถึงแล้ว (storageCleanupService — docs/uploads.md §7)
 *   GET | POST — header `Authorization: Bearer <CRON_SECRET>` (ไม่ตั้ง CRON_SECRET = ปิด endpoint)
 *   ?apply=true — ลบจริง (ไม่ส่ง = dry-run รายงานอย่างเดียว)
 *   ?days=N — ลบเฉพาะไฟล์ที่อัปโหลดมานานกว่า N วัน (ค่าเริ่มต้น 60 · ต่ำสุด 7)
 *   ตั้งให้เรียกสัปดาห์ละครั้ง · รันซ้ำได้ (ลบไม่เกิน 500 ไฟล์ต่อรอบ ที่เหลือรอบหน้า)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { assertCronAuthorized } from "@/lib/cronAuth";
import { badRequest } from "@/lib/httpError";
import { parseBool, parseNumber } from "@/lib/queryParams";
import { cleanupUnusedUploads, MIN_AGE_DAYS_FLOOR } from "@/services/storageCleanupService";

const handler = route(async (req: NextRequest) => {
  assertCronAuthorized(req);
  const sp = req.nextUrl.searchParams;
  const days = parseNumber(sp.get("days"));
  if (sp.get("days") !== null && !(days !== undefined && days >= MIN_AGE_DAYS_FLOOR)) {
    throw badRequest(`days ต้องเป็นตัวเลขไม่น้อยกว่า ${MIN_AGE_DAYS_FLOOR}`);
  }
  const apply = parseBool(sp.get("apply")) ?? false;
  return ok(await cleanupUnusedUploads({ apply, minAgeDays: days }));
});

export const GET = handler;
export const POST = handler;
