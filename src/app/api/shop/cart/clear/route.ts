/** POST /api/shop/cart/clear — ล้างรายการทั้งหมดในตะกร้าของผู้ใช้ที่ล็อกอิน */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as cartService from "@/services/cartService";

export const POST = withAuth(async (session) => {
  return ok(await cartService.clearCart(session.user_id));
});
