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
import { deleteImages } from "../lib/upload";

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

async function update(id: string, input: Record<string, unknown>) {
  // ดึงรูปเดิมไว้ก่อนเขียนทับ — เฉพาะตอนที่ input มี banner_img ส่งมาจริง (ไม่งั้นไม่ต้องยุ่งกับรูปเลย)
  const oldImg =
    input.banner_img !== undefined
      ? ((await base.getById(id).catch(() => null)) as { banner_img?: string } | null)?.banner_img
      : undefined;

  const result = await base.update(id, input);

  if (oldImg && oldImg !== (result as { banner_img?: string }).banner_img) {
    await deleteImages([oldImg]);
  }
  return result;
}

export const bannerService = { ...base, update };

export default bannerService;
