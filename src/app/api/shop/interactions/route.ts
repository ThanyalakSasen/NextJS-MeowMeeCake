/**
 * POST /api/shop/interactions — บันทึกว่าลูกค้าเปิดดูสินค้า (ป้อนระบบแนะนำสินค้า · ต้องล็อกอิน)
 *   body: { product_id, action_type: "view" } → { recorded } (ดูซ้ำภายใน 30 นาที = false)
 *   สินค้าไม่มี/ถูกลบ = 404 · เกิน 120 ครั้ง/นาที = 429
 *   add_to_cart บันทึกเองตอน POST /api/shop/cart/items · wishlist = /api/shop/favorites · purchase = จากออเดอร์
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parseBody } from "@/lib/validate";
import { trackInteractionBody } from "@/schemas/interaction";
import * as interactionService from "@/services/interactionService";

export const POST = withAuth(async (session, req) => {
  const body = await parseBody(req, trackInteractionBody);
  return ok(await interactionService.trackView(session.user_id, body.product_id));
});
