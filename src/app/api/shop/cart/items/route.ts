/**
 * POST /api/shop/cart/items — เพิ่มสินค้าเข้าตะกร้าของผู้ใช้ที่ล็อกอิน
 *   body: { product_id, variant_ids? (ทุกกลุ่มตัวเลือก) | variant_id? (แบบเดิม), selected_options?: [{option_id, text_value?}], quantity }
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
    // เดิมไม่ส่ง variant_ids ต่อ → สินค้าที่มีกลุ่มบังคับเลือกใส่ตะกร้าจากหน้าเว็บไม่ได้เลย (ได้ 400 "กรุณาเลือก …")
    variant_ids: body.variant_ids ?? null,
    variant_id: body.variant_id ?? null,
    selected_options: body.selected_options,
    quantity: body.quantity,
  });
  return created(item);
});
