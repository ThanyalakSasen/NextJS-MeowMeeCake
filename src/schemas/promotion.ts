/**
 * schemas/promotion — validation ของ /api/admin/promotions (custom route)
 * discountEngine ตรวจ logic ระดับออเดอร์อีกชั้น (min/scope/ช่องทาง) — ที่นี่ตรวจแค่ shape + range
 */
import { z } from "zod";
import { objectId } from "./common";

const DISCOUNT_TYPES = ["Percentage", "Amount", "FreeShipping"] as const;
const CHANNELS = ["online", "instore"] as const;

const base = z.object({
  promotion_code: z.string().trim().min(1).max(50),
  promotion_name: z.string().trim().min(1).max(200),
  promotion_desc: z.string().trim().max(1000).optional(),
  discount_type: z.enum(DISCOUNT_TYPES),
  discount_value: z.number().nonnegative(),
  is_active: z.boolean().optional(),
  applicable_channels: z.array(z.enum(CHANNELS)).min(1).optional(),
  min_order_amount: z.number().nonnegative().nullish(),
  min_quantity: z.number().int().nonnegative().nullish(),
  applicable_products: z.array(objectId).optional(),
  applicable_categories: z.array(objectId).optional(),
  max_discount_amount: z.number().nonnegative().nullish(),
  usage_limit: z.number().int().positive().nullish(),
  max_user_per_user: z.number().int().positive().nullish(),
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),
});

export const promotionCreate = base
  .refine((d) => d.end_date >= d.start_date, {
    message: "end_date ต้องไม่ก่อน start_date",
    path: ["end_date"],
  })
  .refine((d) => d.discount_type !== "Percentage" || d.discount_value <= 100, {
    message: "โปร Percentage: discount_value ต้องไม่เกิน 100",
    path: ["discount_value"],
  });

// PATCH = partial (cross-field refine ทำไม่ได้กับ partial — service ตรวจซ้ำ)
export const promotionUpdate = base.partial();
