/**
 * POST /api/shop/cart/items — เพิ่มสินค้าเข้าตะกร้าของผู้ใช้ที่ล็อกอิน
 *   body: { product_id, variant_id?, selected_options?: [{option_id, text_value?}], quantity }
 *   ตรวจด้วย schemas/cart.addCartItemBody
 */
import { created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parseBody } from "@/lib/validate";
import { addCartItemBody } from "@/schemas/cart";
import * as cartService from "@/services/cartService";

export const POST = withAuth(async (session, req) => {
  const body = await parseBody(req, addCartItemBody);
  const item = await cartService.addItem(session.user_id, {
    product_id: body.product_id,
    variant_id: body.variant_id ?? null,
    selected_options: body.selected_options,
    quantity: body.quantity,
  });
  return created(item);
});
