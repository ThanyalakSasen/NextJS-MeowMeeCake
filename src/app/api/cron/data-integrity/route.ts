/**
 * /api/cron/data-integrity — ตรวจข้อมูลสินค้าผิดปกติ (dataIntegrityService — docs/BACKLOG4.md Y11)
 *   GET | POST — header `Authorization: Bearer <CRON_SECRET>` (ไม่ตั้ง CRON_SECRET = ปิด endpoint)
 *   ?notify=false — ตรวจอย่างเดียว ไม่แจ้งเจ้าของร้าน
 *   ตั้งให้เรียกวันละครั้ง · อ่านอย่างเดียว ไม่แก้ข้อมูล
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { assertCronAuthorized } from "@/lib/cronAuth";
import { parseBool } from "@/lib/queryParams";
import { checkDataIntegrity } from "@/services/dataIntegrityService";

const handler = route(async (req: NextRequest) => {
  assertCronAuthorized(req);
  const notify = parseBool(req.nextUrl.searchParams.get("notify")) ?? true;
  return ok(await checkDataIntegrity({ notify }));
});

export const GET = handler;
export const POST = handler;
