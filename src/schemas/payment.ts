/**
 * schemas/payment — validation ของ /api/shop/payments/*
 */
import { z } from "zod";
import { objectId } from "./common";

export const createPaymentBody = z
  .object({
    order_id: objectId.nullish(),
    preorder_id: objectId.nullish(),
    amount: z.number().positive(),
    promptpay_ref: z.string().trim().max(100).nullish(),
    slip_image_url: z.string().trim().max(1000).nullish(),
  })
  .refine((d) => Boolean(d.order_id) !== Boolean(d.preorder_id), {
    message: "ต้องระบุ order_id หรือ preorder_id อย่างใดอย่างหนึ่ง",
    path: ["order_id"],
  });
export type CreatePaymentBody = z.infer<typeof createPaymentBody>;

export const submitSlipBody = z.object({
  slip_image_url: z.string().trim().min(1).max(1000),
  promptpay_ref: z.string().trim().max(100).nullish(),
});
export type SubmitSlipBody = z.infer<typeof submitSlipBody>;

export const listPaymentQuery = z.object({
  order_id: objectId.optional(),
  preorder_id: objectId.optional(),
  status: z.enum(["pending", "paid", "failed", "refunded"]).optional(),
});
export type ListPaymentQuery = z.infer<typeof listPaymentQuery>;
