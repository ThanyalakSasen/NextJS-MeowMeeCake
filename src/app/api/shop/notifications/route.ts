/**
 * /api/shop/notifications — กระดิ่งแจ้งเตือนในเว็บของลูกค้า (ของตัวเองเท่านั้น · customer-backend-merge.md §8.12)
 *   GET   ?limit= (ค่าเริ่มต้น 20 · สูงสุด 100) → { items, unread_count } ล่าสุดก่อน · เฉพาะที่ถึงเวลาแสดงแล้ว
 *   PATCH → อ่านทั้งหมด { updated, unread_count: 0 }
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as customerNotifyService from "@/services/customerNotifyService";

export const GET = withAuth(async (session, req) =>
  ok(await customerNotifyService.listMyNotifications(session.user_id, req.nextUrl.searchParams.get("limit")))
);

export const PATCH = withAuth(async (session) => ok(await customerNotifyService.markAllRead(session.user_id)));
