/**
 * schemas/review — validation ของรีวิวลูกค้า (POST /api/shop/reviews, PATCH /[id])
 * user_id มาจาก session · สิทธิ์รีวิว (order completed, 1 รีวิว/order_item) ตรวจใน reviewService
 */
import { z } from "zod";
import { objectId } from "./common";

const rating = z.coerce.number().int().min(1).max(5);
const image = z.array(z.string().trim().min(1).max(1000));

export const reviewCreateBody = z.object({
  order_item_id: objectId,
  rating,
  review_text: z.string().trim().max(2000).nullable().optional(),
  image: image.optional(),
});

export const reviewUpdateBody = z
  .object({
    rating,
    review_text: z.string().trim().max(2000).nullable(),
    image,
  })
  .partial();
