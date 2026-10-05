/**
 * reviewMediaService — อัปโหลด/ลบรูป-วิดีโอประกอบรีวิว (ย้ายมาจากฝั่งลูกค้า reviewUploadController · reviewMediaCleanup ·
 * customer-backend-merge.md §8.18)
 *
 *   - อัปโหลดทีละไฟล์ผ่าน src/lib/upload.ts (localDisk / S3 ตาม UPLOAD_DRIVER · ตรวจลายเซ็นไฟล์จริง)
 *     รูป ≤ 5 MB (jpg/png/webp/avif) · วิดีโอ ≤ 30 MB (mp4/mov/webm) · โฟลเดอร์ reviews · ชื่อไฟล์ขึ้นต้นด้วย user id
 *   - ลบไฟล์ค้าง (ส่งรีวิวไม่สำเร็จ): เฉพาะไฟล์ของตัวเอง (user id ในชื่อไฟล์) และยังไม่มีรีวิวไหนอ้างถึง — ไม่ผ่านข้ามเงียบ ๆ
 *   - เก็บกวาดไฟล์ค้าง > 24 ชม. (localDisk): npm run cleanup:review-media — รีวิวที่ถูก soft delete ยังนับว่าใช้อยู่
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import dbConnect from "../lib/dbConnect";
import { badRequest } from "../lib/httpError";
import { deleteImages, saveImages, type MediaKind } from "../lib/upload";
import reviewModel from "../models/reviewModel";

const DIR = "reviews";
/** ลบได้ไม่เกินจำนวนไฟล์ที่ใส่ได้ใน 1 รีวิว (รูป 5 + วิดีโอ 1) */
const MAX_DELETE = 6;
/** ไฟล์ต้องเก่ากว่านี้ถึงนับว่าค้าง (อัปโหลด → บันทึกรีวิว ปกติห่างกันไม่กี่วินาที) */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

const ownerKey = (userId: string) => userId.replace(/[^a-z0-9]/gi, "").toLowerCase();
/** ชื่อไฟล์จาก url (ทั้ง /uploads/reviews/<file> และ <S3 base>/reviews/<file>) */
function fileNameOf(url: string): string | null {
  const m = /\/reviews\/([^/\\?#]+)$/.exec(url);
  return m ? m[1] : null;
}

export async function uploadReviewMedia(userId: string, file: File | null, type: unknown): Promise<{ url: string; type: MediaKind }> {
  if (!file || (type !== "image" && type !== "video")) throw badRequest("ข้อมูลไม่ครบถ้วน (file + type: image | video)");
  const [saved] = await saveImages([file], DIR, { kind: type, prefix: ownerKey(userId) });
  return { url: saved.url, type };
}

/** ไฟล์ที่มีรีวิวอ้างถึงแล้ว (รวมรีวิวที่ถูก soft delete) */
async function usedUrls(urls: string[]): Promise<Set<string>> {
  const inUse = await reviewModel
    .find({ $or: [{ image: { $in: urls } }, { video: { $in: urls } }] })
    .select("image video")
    .lean<Array<{ image?: string[]; video?: string | null }>>();
  return new Set(inUse.flatMap((r) => [...(r.image ?? []), r.video ?? ""]));
}

/** ลบไฟล์ค้างของตัวเองที่ยังไม่ถูกใช้ในรีวิว → { deleted } */
export async function deleteOwnReviewMedia(userId: string, rawUrls: unknown): Promise<{ deleted: string[] }> {
  if (!Array.isArray(rawUrls)) throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง (urls ต้องเป็นรายการ)");
  const prefix = `${ownerKey(userId)}-`;
  const urls = [...new Set(rawUrls.filter((u): u is string => typeof u === "string"))]
    .slice(0, MAX_DELETE)
    .filter((u) => (fileNameOf(u) ?? "").startsWith(prefix));
  if (urls.length === 0) return { deleted: [] };

  await dbConnect();
  const used = await usedUrls(urls);
  const deleted = urls.filter((u) => !used.has(u));
  await deleteImages(deleted);
  return { deleted };
}

/** เก็บกวาดไฟล์รีวิวที่ค้าง (localDisk เท่านั้น — S3 ตั้ง lifecycle rule ที่ bucket แทน) → จำนวนที่ลบ */
export async function cleanupOrphanReviewMedia(now = Date.now()): Promise<number> {
  if (process.env.UPLOAD_DRIVER === "s3") return 0;
  const dir = join(process.cwd(), "public", "uploads", DIR);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  const candidates: string[] = [];
  for (const name of names) {
    try {
      const info = await stat(join(dir, name));
      if (info.isFile() && now - info.mtimeMs > ORPHAN_GRACE_MS) candidates.push(`/uploads/${DIR}/${name}`);
    } catch {
      // ไฟล์หายไประหว่างไล่ดู — ข้าม
    }
  }
  if (candidates.length === 0) return 0;
  await dbConnect();
  let deleted = 0;
  for (let i = 0; i < candidates.length; i += 200) {
    const batch = candidates.slice(i, i + 200);
    const used = await usedUrls(batch);
    const orphans = batch.filter((u) => !used.has(u));
    await deleteImages(orphans);
    deleted += orphans.length;
  }
  return deleted;
}
