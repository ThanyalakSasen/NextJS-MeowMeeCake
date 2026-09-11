/**
 * /api/admin/notifications/[id]
 *   PATCH  — mark read/unread เท่านั้น (body: { is_read })
 *   DELETE — ลบ soft
 * ไม่ผูก menu permission — แค่ต้อง login (แจ้งเตือนเห็นร่วมกันทั้งร้าน ไม่ใช่สิทธิ์เฉพาะเมนู)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/authGuard";
import { notificationService } from "@/services/notificationService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  requireAuth(req);
  const { id } = await ctx.params;
  const body = await req.json();
  return ok(await notificationService.update(id, { is_read: !!body.is_read }));
});

export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  requireAuth(req);
  const { id } = await ctx.params;
  return ok(await notificationService.remove(id));
});
