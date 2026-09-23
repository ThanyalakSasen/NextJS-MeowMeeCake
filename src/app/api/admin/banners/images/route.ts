/**
 * POST /api/admin/banners/images — อัปโหลดรูปแบนเนอร์ (สิทธิ์ products.update — ดู
 * auth: { menu: "products" } ที่ /api/admin/banners เอง เหตุผลเดียวกัน)
 *   Content-Type: multipart/form-data
 *   field: "file" (หรือ "banner_img") — แบนเนอร์มีรูปเดียว รับแค่ไฟล์แรกที่แนบมา
 *   รองรับ JPEG / PNG / WEBP / AVIF, ≤ 5 MB
 *
 *   คืน: { url, filename, size }
 *   นำ url ไปใส่ใน field banner_img ตอน POST/PATCH /api/admin/banners (แทน base64 เดิม —
 *   docs/BACKLOG.md ฝั่ง frontend §5/schemas/catalog.ts bannerCreate.banner_img comment)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import { saveImages } from "@/lib/upload";

export const POST = withPermission("products", "update", async (_s, req) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("ต้องส่งเป็น multipart/form-data");

  const files = [...form.getAll("file"), ...form.getAll("banner_img")].filter(
    (f): f is File => f instanceof File
  );

  const [image] = await saveImages(files.slice(0, 1), "banners");
  if (!image) throw badRequest("ไม่พบไฟล์ที่อัปโหลด");

  audit(req, {
    action: `อัปโหลดรูปแบนเนอร์ ${image.filename}`,
    action_type: "CREATE",
    entity: "BannerImage",
    details: { filename: image.filename },
  });
  return ok(image);
});
