/**
 * /api/shop/cart/items/[id]  (ตะกร้าของผู้ใช้ที่ล็อกอิน — service ผูก cart กับ session.user_id อยู่แล้ว)
 *   PATCH  — แก้จำนวน  body: { quantity }  (quantity = 0 → ลบรายการ) — ตรวจด้วย schemas/cart.updateCartItemBody
 *   DELETE — ลบรายการออกจากตะกร้า
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { parseBody, parse } from "@/lib/validate";
import { updateCartItemBody } from "@/schemas/cart";
import { objectId } from "@/schemas/common";
import * as cartService from "@/services/cartService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req, ctx: Ctx) => {
  const id = parse((await ctx.params).id, objectId, "id ของรายการในตะกร้า");
  const { quantity } = await parseBody(req, updateCartItemBody);
  return ok(await cartService.updateItemQuantity(session.user_id, id, quantity));
});

export const DELETE = withAuth(async (session, _req, ctx: Ctx) => {
  const id = parse((await ctx.params).id, objectId, "id ของรายการในตะกร้า");
  return ok(await cartService.removeItem(session.user_id, id));
});
