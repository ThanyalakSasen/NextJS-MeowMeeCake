/**
 * GET /api/admin/notifications — รายการแจ้งเตือน (ทุกคนที่ login แล้วเห็นร่วมกัน ไม่ผูก menu permission)
 *   ?is_read= ?module= ?type= ?search=
 * ไม่มี POST — แจ้งเตือนสร้างจาก notificationService.notify() ตอนมีเหตุการณ์จริงเท่านั้น (ดูคอมเมนต์
 * ใน src/services/notificationService.ts)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/authGuard";
import { parseBool, parsePagination } from "@/lib/queryParams";
import { notificationService } from "@/services/notificationService";
import type { NotificationModule, NotificationType } from "@/services/notificationService";

export const GET = route(async (req: NextRequest) => {
  requireAuth(req);
  const sp = req.nextUrl.searchParams;
  const filter: Record<string, unknown> = {};
  if (sp.has("is_read")) filter.is_read = parseBool(sp.get("is_read"));
  if (sp.get("module")) filter.module = sp.get("module") as NotificationModule;
  if (sp.get("type")) filter.type = sp.get("type") as NotificationType;

  const result = await notificationService.list({
    pagination: parsePagination(sp),
    search: sp.get("search") ?? undefined,
    filter,
  });
  return ok(result);
});
