/**
 * schemas/checkout — POST /api/shop/checkout (สั่งซื้อรวม: สินค้าปกติในตะกร้า + พรีออเดอร์หลายรอบในครั้งเดียว)
 *   order     = ออเดอร์สินค้าปกติจากตะกร้า (รูปแบบเดียวกับ POST /api/shop/orders · source "cart" เท่านั้น)
 *   preorders = พรีออเดอร์ 1 ใบต่อรอบ (รูปแบบเดียวกับ POST /api/shop/preorders)
 * คูปอง/โค้ดส่วนลดรวมกันได้สูงสุด 2 รายการต่อการสั่งซื้อ (หน้าเว็บเลือกบิลที่ลดได้มากที่สุดให้แต่ละตัว)
 */
import { z } from "zod";
import { createOrderBody, discountCountOf } from "./order";
import { MAX_DISCOUNTS_PER_ORDER, TOO_MANY_DISCOUNTS_MESSAGE } from "../lib/promoCode";
import { createPreorderBody } from "./preorder";

export const MAX_CHECKOUT_PREORDERS = 10;

export const checkoutBody = z
  .object({
    order: createOrderBody.nullish(),
    preorders: z.array(createPreorderBody).max(MAX_CHECKOUT_PREORDERS).default([]),
  })
  .refine((d) => !!d.order || d.preorders.length > 0, { message: "ไม่มีรายการที่จะสั่งซื้อ", path: ["order"] })
  .refine((d) => !d.order || (d.order.source ?? "cart") === "cart", {
    message: "สั่งซื้อรวมใช้สินค้าจากตะกร้าเท่านั้น",
    path: ["order", "source"],
  })
  .refine((d) => new Set(d.preorders.map((p) => p.round_id)).size === d.preorders.length, {
    message: "พรีออเดอร์รอบเดียวกันต้องรวมเป็นบิลเดียว",
    path: ["preorders"],
  })
  .refine(
    (d) =>
      [d.order, ...d.preorders].reduce((n, b) => n + (b ? discountCountOf({ ...b, promotion_id: "promotion_id" in b ? b.promotion_id : null }) : 0), 0) <=
      MAX_DISCOUNTS_PER_ORDER,
    { message: TOO_MANY_DISCOUNTS_MESSAGE, path: ["preorders"] }
  );
export type CheckoutBody = z.infer<typeof checkoutBody>;
