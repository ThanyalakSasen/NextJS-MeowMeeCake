/**
 * schemas/review — validation ของรีวิวลูกค้า (POST /api/shop/reviews, PATCH /[id])
 * user_id มาจาก session · สิทธิ์รีวิว (completed + ชำระแล้ว, 1 รีวิว/รายการ) ตรวจใน reviewService
 */
import { z } from "zod";
import { objectId } from "./common";

const rating = z.coerce.number().int().min(1).max(5);
const image = z.array(z.string().trim().min(1).max(1000)).max(5, "รูปได้ไม่เกิน 5 รูปต่อรีวิว");
// วิดีโอ 1 คลิป (URL จาก POST /api/shop/reviews/upload) · null = ไม่มี (customer-backend-merge.md §8.18)
const video = z.string().trim().min(1).max(1000).nullable();

// แง่มุมที่ลูกค้ากด "ชอบ" / "ควรปรับปรุง" (customer-backend-merge.md §8.20)
const aspectFeedback = z
  .array(z.object({ aspect_id: objectId, sentiment: z.enum(["positive", "negative"]) }))
  .max(50);

/**
 * รายการที่จะรีวิว — ระบุอย่างใดอย่างหนึ่ง: order_item_id · preorder_item_id (ชิ้นเดียว) ·
 * order_item_ids · preorder_item_ids (รีวิวรวม ≤ 30 ชิ้น — เนื้อหาเดียวกันทุกชิ้น)
 */
export const reviewCreateBody = z
  .object({
    order_item_id: objectId.optional(),
    preorder_item_id: objectId.optional(),
    order_item_ids: z.array(objectId).min(1).max(30).optional(),
    preorder_item_ids: z.array(objectId).min(1).max(30).optional(),
    rating,
    review_text: z.string().trim().max(2000).nullable().optional(),
    image: image.optional(),
    video: video.optional(),
    aspect_feedback: aspectFeedback.optional(),
  })
  .refine(
    (b) => [b.order_item_id, b.preorder_item_id, b.order_item_ids, b.preorder_item_ids].filter((v) => v !== undefined).length === 1,
    { message: "ระบุ order_item_id, preorder_item_id, order_item_ids หรือ preorder_item_ids อย่างใดอย่างหนึ่ง" }
  );

export const reviewUpdateBody = z
  .object({
    rating,
    review_text: z.string().trim().max(2000).nullable(),
    image,
    video,
    aspect_feedback: aspectFeedback,
  })
  .partial();
