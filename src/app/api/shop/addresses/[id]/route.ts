/**
 * /api/shop/addresses/[id]  (ของผู้ใช้ที่ล็อกอิน)
 *   GET    — ดูที่อยู่รายตัว
 *   PATCH  — แก้ที่อยู่ (ส่ง is_default: true เพื่อตั้งเป็นค่าเริ่มต้น)
 *   DELETE — ลบที่อยู่ (soft ; ถ้าลบอันที่เป็น default จะเลื่อนอันอื่นขึ้นแทน)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as addressService from "@/services/addressService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await addressService.getById(session.user_id, id));
});

export const PATCH = withAuth(async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  return ok(await addressService.update(session.user_id, id, body));
});

export const DELETE = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await addressService.remove(session.user_id, id));
});
