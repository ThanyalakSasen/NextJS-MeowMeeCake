/**
 * GET /api/admin/pos/member?phone=0812345678
 *   หาสมาชิกด้วยเบอร์มือถือที่เคาน์เตอร์ — ผูกออเดอร์หน้าร้านกับสมาชิกแทนบัญชี "ลูกค้าทั่วไป" ให้ได้แต้มสะสม
 *   คืน { members: [{ _id, user_fullname, user_phone, points_balance }], baht_per_point }
 *   ไม่พบ = members ว่าง (ไม่ใช่ 404 — POS ขายต่อแบบลูกค้าทั่วไปได้) · เบอร์ผิดรูปแบบ = 400
 *   แต้มได้ตอนออเดอร์ completed (POST /admin/pos/orders/[id]/checkout) ผ่าน pointsService.syncOrderPoints
 *
 *   สิทธิ์: pos.view (เหมือน API อื่นของ POS)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import * as userService from "@/services/userService";

export const GET = withPermission("pos", "view", async (_s, req) => {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) throw badRequest("กรุณาระบุ ?phone=");
  return ok(await userService.findPosMembersByPhone(phone));
});
