/**
 * bannerService — CRUD แบนเนอร์หน้าร้าน (Banners)
 *
 * banner_img เป็นไฟล์จริงที่อัปโหลดผ่าน POST /api/admin/banners/images แล้ว (ไม่ใช่ base64 ที่เก็บ
 * ตรงในฟิลด์แบบเดิม) — ต้องลบไฟล์เก่าทิ้งเองตอนแทนที่ด้วยรูปใหม่ ไม่งั้นไฟล์ค้างสะสมใน
 * public/uploads/banners/ ตลอดไป (แพทเทิร์นเดียวกับ productService.ts BACKLOG §3.14 — ต่างกันที่
 * แบนเนอร์มีรูปเดียว ไม่ใช่ array) ไม่ลบไฟล์ตอน remove()/restore() เพราะเป็น soft delete ยังกู้คืนได้
 */
import bannerModel from "../models/bannersModel";
import { createCrudService } from "../lib/crudService";
import { deleteImages, isUploadedUrl, UPLOAD_DIRS } from "../lib/upload";
import { badRequest } from "../lib/httpError";

const WRITABLE = [
  "banner_name",
  "banner_description",
  "banner_img",
  "banner_link",
  "start_date",
  "end_date",
  "sort_order",
  "is_active",
] as const;

const base = createCrudService(bannerModel, {
  label: "แบนเนอร์",
  searchFields: ["banner_name", "banner_description"],
  createFields: WRITABLE,
});

/**
 * banner_img ต้องเป็นไฟล์ที่อัปโหลดผ่าน POST /api/admin/banners/images (public/uploads/banners — docs/uploads.md)
 * เดิมรับ string อะไรก็ได้ → DB มี base64 ก้อนละหลาย MB และลิงก์รูปภายนอก (ย้ายด้วย npm run migrate:upload-files)
 * ส่งค่าเดิมกลับมาซ้ำตอนแก้ฟิลด์อื่นได้ (`existing`) แม้เป็นข้อมูลรุ่นเก่า
 */
function assertBannerImg(url: unknown, existing?: unknown): void {
  if (url === undefined) return;
  if (url === existing) return;
  if (!isUploadedUrl(url, UPLOAD_DIRS.banners)) {
    throw badRequest("banner_img ต้องเป็นไฟล์ที่อัปโหลดผ่าน POST /api/admin/banners/images (multipart)");
  }
}

async function create(input: Record<string, unknown>) {
  assertBannerImg(input.banner_img);
  return base.create(input);
}

async function update(id: string, input: Record<string, unknown>) {
  // ดึงรูปเดิมไว้ก่อนเขียนทับ — เฉพาะตอนที่ input มี banner_img ส่งมาจริง (ไม่งั้นไม่ต้องยุ่งกับรูปเลย)
  const oldImg =
    input.banner_img !== undefined
      ? ((await base.getById(id).catch(() => null)) as { banner_img?: string } | null)?.banner_img
      : undefined;
  assertBannerImg(input.banner_img, oldImg);

  const result = await base.update(id, input);

  if (oldImg && oldImg !== (result as { banner_img?: string }).banner_img) {
    await deleteImages([oldImg]);
  }
  return result;
}

export const bannerService = { ...base, create, update };

export default bannerService;
