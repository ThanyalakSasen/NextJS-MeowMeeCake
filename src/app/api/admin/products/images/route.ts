/**
 * POST /api/admin/products/images — อัปโหลดรูปสินค้า (สิทธิ์ products.update)
 *   Content-Type: multipart/form-data
 *   field: "files" (หรือ "product_img") — แนบได้หลายไฟล์
 *   รองรับ JPEG / PNG / WEBP / AVIF, ≤ 5 MB/ไฟล์, ≤ 8 ไฟล์/ครั้ง
 *
 *   คืน: { images: [{ url, filename, size }], urls: [...] }
 *   นำ urls ไปใส่ใน field product_img ตอน POST/PATCH /api/admin/products
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import { saveImages } from "@/lib/upload";

export const POST = withPermission("products", "update", async (_s, req) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("ต้องส่งเป็น multipart/form-data");

  const files = [...form.getAll("files"), ...form.getAll("product_img")].filter(
    (f): f is File => f instanceof File
  );

  const images = await saveImages(files, "products");
  audit(req, {
    action: `อัปโหลดรูปสินค้า ${images.length} ไฟล์`,
    action_type: "CREATE",
    entity: "ProductImage",
    details: { files: images.map((i) => i.filename) },
  });
  return ok({ images, urls: images.map((i) => i.url) });
});
