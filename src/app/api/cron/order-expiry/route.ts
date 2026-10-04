/**
 * /api/cron/order-expiry — ยกเลิกออเดอร์เว็บที่เลยกำหนดชำระ 30 นาทีแล้วยังไม่ส่งสลิป (orderService.expireUnpaidOrders)
 *   GET | POST — header `Authorization: Bearer <CRON_SECRET>` (ไม่ตั้ง CRON_SECRET = ปิด endpoint)
 *   ตั้งให้เรียกทุก 5 นาที (หรือใช้ npm run cron:order-expiry) — docs/customer-backend-merge.md §8.8
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { assertCronAuthorized } from "@/lib/cronAuth";
import * as orderService from "@/services/orderService";

const handler = route(async (req: NextRequest) => {
  assertCronAuthorized(req);
  return ok(await orderService.expireUnpaidOrders());
});

export const GET = handler;
export const POST = handler;
