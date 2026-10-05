/**
 * schemas/review — validation ของรีวิวลูกค้า (POST /api/shop/reviews, PATCH /[id])
 * user_id มาจาก session · สิทธิ์รีวิว (order completed, 1 รีวิว/order_item) ตรวจใน reviewService
 */
import { z } from "zod";
import { objectId } from "./common";

const rating = z.coerce.number().int().min(1).max(5);
const image = z.array(z.string().trim().min(1).max(1000)).max(5, "รูปได้ไม่เกิน 5 รูปต่อรีวิว");
// วิดีโอ 1 คลิป (URL จาก POST /api/shop/reviews/upload) · null = ไม่มี (customer-backend-merge.md §8.18)
const video = z.string().trim().min(1).max(1000).nullable();

export const reviewCreateBody = z.object({
  order_item_id: objectId,
  rating,
  review_text: z.string().trim().max(2000).nullable().optional(),
  image: image.optional(),
  video: video.optional(),
});

export const reviewUpdateBody = z
  .object({
    rating,
    review_text: z.string().trim().max(2000).nullable(),
    image,
    video,
  })
  .partial();
