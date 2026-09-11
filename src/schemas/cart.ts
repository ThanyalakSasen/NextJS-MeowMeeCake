/**
 * schemas/cart — validation ของ /api/shop/cart/*
 */
import { z } from "zod";
import { objectId } from "./common";

export const addCartItemBody = z.object({
  product_id: objectId,
  variant_id: objectId.nullish(),
  selected_options: z
    .array(z.object({ option_id: objectId, text_value: z.string().max(500).nullish() }))
    .default([]),
  quantity: z.number().int().min(1),
});
export type AddCartItemBody = z.infer<typeof addCartItemBody>;

export const updateCartItemBody = z.object({
  quantity: z.number().int().min(0), // 0 = ลบรายการ
});
export type UpdateCartItemBody = z.infer<typeof updateCartItemBody>;
