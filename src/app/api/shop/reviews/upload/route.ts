/**
 * /api/shop/reviews/upload — ไฟล์ประกอบรีวิว (ย้ายมาจากฝั่งลูกค้า /api/customer/reviews/upload · customer-backend-merge.md §8.18)
 *   POST multipart { file, type: "image" | "video" } → 201 { url, type } · รูป ≤ 5 MB · วิดีโอ ≤ 30 MB (ตรวจลายเซ็นไฟล์จริง)
 *   DELETE { urls: [...] } → { deleted } ลบไฟล์ค้างเมื่อส่งรีวิวไม่สำเร็จ — เฉพาะไฟล์ของตัวเองที่ยังไม่มีรีวิวอ้างถึง (ไม่ผ่านข้ามเงียบ ๆ)
 *   rate-limit อัปโหลด 30 ไฟล์/10 นาที ต่อบัญชี
 */
import { created, ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { rateLimit } from "@/lib/rateLimit";
import * as reviewMediaService from "@/services/reviewMediaService";

export const POST = withAuth(async (session, req) => {
  rateLimit(session.user_id, "shop:review-upload", { limit: 30, windowMs: 10 * 60_000 });
  const form = await req.formData();
  const file = form.get("file");
  return created(
    await reviewMediaService.uploadReviewMedia(session.user_id, file instanceof File ? file : null, form.get("type"))
  );
});

export const DELETE = withAuth(async (session, req) => {
  const body = await req.json().catch(() => null);
  return ok(await reviewMediaService.deleteOwnReviewMedia(session.user_id, body?.urls));
});
