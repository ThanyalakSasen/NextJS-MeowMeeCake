/**
 * /api/shop/addresses  (สมุดที่อยู่ของผู้ใช้ที่ล็อกอิน)
 *   GET  — รายการที่อยู่ (default อยู่บนสุด)
 *   POST — เพิ่มที่อยู่  body: { house_no, sub_district, district, province, zip_code, is_default? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as addressService from "@/services/addressService";

export const GET = withAuth(async (session) => {
  return ok(await addressService.listByUser(session.user_id));
});

export const POST = withAuth(async (session, req) => {
  const body = await req.json();
  return created(await addressService.create(session.user_id, body));
});
