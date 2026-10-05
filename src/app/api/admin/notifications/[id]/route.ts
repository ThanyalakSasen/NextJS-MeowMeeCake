/**
 * /api/admin/notifications/[id]
 *   PATCH  — mark read/unread เท่านั้น (body: { is_read }) — พนักงานทุกคนที่ล็อกอิน
 *   DELETE — ลบ soft — **เฉพาะเจ้าของร้าน (owner)**
 * ไม่ผูก menu permission — แจ้งเตือนเห็นร่วมกันทั้งร้าน ไม่ใช่สิทธิ์เฉพาะเมนู
 *
 * docs/BACKLOG4.md Y6 — เดิม DELETE เช็คแค่ล็อกอิน staff คนไหนก็ลบได้ → แจ้งเตือนสำคัญ (สต็อกใกล้หมด,
 * โควตา LINE, ปิดรอบ/ใบผลิต) หายก่อนเจ้าของเห็น · staff ใช้ mark อ่านแล้ว (PATCH) แทน
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { authenticate, requireRole } from "@/lib/authGuard";
import { notificationService } from "@/services/notificationService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  await authenticate(req);
  const { id } = await ctx.params;
  const body = await req.json();
  return ok(await notificationService.update(id, { is_read: !!body.is_read }));
});

export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  const session = await authenticate(req);
  requireRole(session, "owner");
  const { id } = await ctx.params;
  return ok(await notificationService.remove(id));
});
