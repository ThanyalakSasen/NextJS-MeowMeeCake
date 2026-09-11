/** GET /api/shop/cart — ตะกร้าของผู้ใช้ที่ล็อกอิน พร้อมรายการและยอดรวม (สร้างให้อัตโนมัติ) */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as cartService from "@/services/cartService";

export const GET = withAuth(async (session) => {
  return ok(await cartService.getCartDetail(session.user_id));
});
