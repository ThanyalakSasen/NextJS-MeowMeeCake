/**
 * /api/cron/preorder-reminders — เตือนลูกค้าก่อนวันรับพรีออเดอร์ (preorderReminderService — docs/LINE.md §9.7)
 *   GET | POST  — header `Authorization: Bearer <CRON_SECRET>` (Vercel Cron เรียกด้วย GET)
 *   ?dry_run=true — แค่ดูว่าจะเตือนใครบ้าง ไม่ส่ง ไม่ทำเครื่องหมาย
 *   ตั้งให้ตัวตั้งเวลาเรียกวันละครั้ง (เช่น 18:00 เวลาไทย = 11:00 UTC) · รันซ้ำได้ ไม่ส่งซ้ำ
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { assertCronAuthorized } from "@/lib/cronAuth";
import { parseBool } from "@/lib/queryParams";
import * as preorderReminderService from "@/services/preorderReminderService";

const handler = route(async (req: NextRequest) => {
  assertCronAuthorized(req);
  const dryRun = parseBool(req.nextUrl.searchParams.get("dry_run")) ?? false;
  return ok(await preorderReminderService.sendPickupReminders({ dryRun }));
});

export const GET = handler;
export const POST = handler;
