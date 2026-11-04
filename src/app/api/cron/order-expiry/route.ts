/**
 * /api/cron/order-expiry — ยกเลิกออเดอร์เว็บที่เลยกำหนดชำระ 30 นาทีแล้วยังไม่ส่งสลิป (orderService.expireUnpaidOrders)
 *   GET | POST — header `Authorization: Bearer <CRON_SECRET>` (ไม่ตั้ง CRON_SECRET = ปิด endpoint)
 *   + คืนรายการเดิมของพรีออเดอร์ที่ไม่ชำระส่วนต่างภายใน 30 นาที (preorderExtraRevertService)
 *   ตั้งให้เรียกทุก 5 นาที (หรือใช้ npm run cron:order-expiry) — docs/customer-backend-merge.md §8.8
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { assertCronAuthorized } from "@/lib/cronAuth";
import * as orderService from "@/services/orderService";
import { revertExpiredExtraEdits } from "@/services/preorderExtraRevertService";

const handler = route(async (req: NextRequest) => {
  assertCronAuthorized(req);
  const orders = await orderService.expireUnpaidOrders();
  const preorder_extra = await revertExpiredExtraEdits();
  return ok({ ...orders, preorder_extra });
});

export const GET = handler;
export const POST = handler;
