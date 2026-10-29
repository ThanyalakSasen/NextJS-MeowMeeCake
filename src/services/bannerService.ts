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

/**
 * วันสิ้นสุดต้องไม่ก่อนวันเริ่ม (เทียบค่าที่ "จะเป็นหลังบันทึก" — PATCH ส่งมาข้างเดียวก็ตรวจกับค่าเดิม)
 * เดิมไม่ตรวจ: ตั้งช่วงกลับหัวผ่าน API ได้ แบนเนอร์ไม่ขึ้นหน้าร้านเลยโดยไม่มีใครรู้
 */
function assertDateRange(start: unknown, end: unknown): void {
  if (start == null || end == null) return;
  if (new Date(end as string).getTime() < new Date(start as string).getTime()) {
    throw badRequest("end_date ต้องไม่ก่อน start_date");
  }
}

async function create(input: Record<string, unknown>) {
  assertBannerImg(input.banner_img);
  assertDateRange(input.start_date, input.end_date);
  return base.create(input);
}

async function update(id: string, input: Record<string, unknown>) {
  // ดึงข้อมูลเดิมเฉพาะตอนต้องใช้ — รูปเดิม (ลบไฟล์ตอนแทนที่) / วันที่เดิม (ตรวจช่วงวัน)
  const needsExisting = input.banner_img !== undefined || input.start_date !== undefined || input.end_date !== undefined;
  const existing = needsExisting
    ? ((await base.getById(id).catch(() => null)) as { banner_img?: string; start_date?: unknown; end_date?: unknown } | null)
    : null;
  const oldImg = input.banner_img !== undefined ? existing?.banner_img : undefined;
  assertBannerImg(input.banner_img, oldImg);
  assertDateRange(
    input.start_date !== undefined ? input.start_date : existing?.start_date,
    input.end_date !== undefined ? input.end_date : existing?.end_date
  );

  const result = await base.update(id, input);

  if (oldImg && oldImg !== (result as { banner_img?: string }).banner_img) {
    await deleteImages([oldImg]);
  }
  return result;
}

export const bannerService = { ...base, create, update };

export default bannerService;
