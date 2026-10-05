/**
 * /api/cron/monthly-summary — สรุปยอดรายเดือนถึงเจ้าของร้าน (monthlySummaryService — docs/LINE.md §9.13)
 *   GET | POST — header `Authorization: Bearer <CRON_SECRET>` (ไม่ตั้ง CRON_SECRET = ปิด endpoint)
 *   ?month=YYYY-MM — เดือนที่จะสรุป (ไม่ส่ง = เดือนที่แล้วตามเวลาไทย)
 *   ?dry_run=true — แค่ดูตัวเลข/ข้อความ ไม่บันทึก ไม่ส่ง LINE
 *   ตั้งให้เรียกวันที่ 1 ของเดือน · รันซ้ำได้ ส่งครั้งเดียวต่อเดือน
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { assertCronAuthorized } from "@/lib/cronAuth";
import { badRequest } from "@/lib/httpError";
import { parseBool } from "@/lib/queryParams";
import { isMonthString, sendMonthlySummary } from "@/services/monthlySummaryService";

const handler = route(async (req: NextRequest) => {
  assertCronAuthorized(req);
  const sp = req.nextUrl.searchParams;
  const month = sp.get("month") ?? undefined;
  if (month !== undefined && !isMonthString(month)) throw badRequest("month ต้องเป็นรูปแบบ YYYY-MM");
  const dryRun = parseBool(sp.get("dry_run")) ?? false;
  return ok(await sendMonthlySummary({ month, dryRun }));
});

export const GET = handler;
export const POST = handler;
