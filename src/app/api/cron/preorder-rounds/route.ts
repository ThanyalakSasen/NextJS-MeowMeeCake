/**
 * /api/cron/preorder-rounds — วงจรอัตโนมัติของรอบพรีออเดอร์ (preorderRoundLifecycleService.runRoundScheduler
 * — docs/preorder-round-flow.md §6)
 *   GET | POST — header `Authorization: Bearer <CRON_SECRET>` (ไม่ตั้ง CRON_SECRET = ปิด endpoint)
 *   ทำ: เปิดรอบที่ถึง open_date · ปิดรอบที่เลย close_date (+ ยกเลิกคนไม่จ่าย + สร้างใบสั่งผลิต) ·
 *       ยกเลิกพรีออเดอร์ที่เลยกำหนดชำระ
 *   ตั้งให้เรียกทุก 15 นาที (ยิ่งถี่ รอบยิ่งเปิด/ปิดตรงเวลา) · รันซ้ำได้ ไม่ทำซ้ำ
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { assertCronAuthorized } from "@/lib/cronAuth";
import { runRoundScheduler } from "@/services/preorderRoundLifecycleService";

const handler = route(async (req: NextRequest) => {
  assertCronAuthorized(req);
  return ok(await runRoundScheduler());
});

export const GET = handler;
export const POST = handler;
