/**
 * upload — ตัวช่วยรับไฟล์รูปจาก multipart/form-data แล้วบันทึกลง public/uploads/<dir>/
 *
 * ตรวจ 3 ชั้น: ขนาด → นามสกุลไฟล์ → magic bytes (ลายเซ็นไฟล์จริง) — ไม่เชื่อ MIME จาก client
 * คืน url ที่ Next.js serve static ได้ทันที: /uploads/<dir>/<filename>
 *
 * ⚠️ เขียนลง public/ ได้เฉพาะตอน self-host (VPS / เครื่องตัวเอง)
 *    บน serverless (Vercel ฯลฯ) public/ เป็น read-only ตอน runtime — ต้องเปลี่ยนไปใช้ object storage (S3/R2/GCS)
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { badRequest } from "./httpError";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB ต่อไฟล์
const MAX_FILES = 8;
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

export interface SavedFile {
  url: string;
  filename: string;
  size: number;
}

/** ตรวจลายเซ็นไฟล์จริง → คืนนามสกุลมาตรฐาน หรือ null ถ้าไม่ใช่รูปที่รองรับ */
function sniffImageExt(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return ".png";
  }
  // WEBP: "RIFF"....(4 bytes)...."WEBP"
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return ".webp";
  }
  // AVIF: box "ftyp" ที่ offset 4 + brand "avif"/"avis" ที่ offset 8
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return ".avif";
  }
  return null;
}

/**
 * รับ File[] (จาก formData.getAll(...)) บันทึกเป็นรูป คืนรายการ url
 * @param dir โฟลเดอร์ย่อยใน public/uploads (จะถูก sanitize เหลือ [a-z0-9_-])
 */
export async function saveImages(files: File[], dir: string): Promise<SavedFile[]> {
  if (!Array.isArray(files) || files.length === 0) {
    throw badRequest("ไม่พบไฟล์ที่อัปโหลด");
  }
  if (files.length > MAX_FILES) {
    throw badRequest(`อัปโหลดได้สูงสุด ${MAX_FILES} ไฟล์ต่อครั้ง`);
  }

  const safeDir = dir.replace(/[^a-z0-9_-]/gi, "") || "misc";
  const targetDir = join(process.cwd(), "public", "uploads", safeDir);
  await mkdir(targetDir, { recursive: true });

  const saved: SavedFile[] = [];
  for (const file of files) {
    if (!(file instanceof File)) continue;

    // 1) ขนาด (เช็คจาก metadata ก่อนอ่านเข้าหน่วยความจำ)
    if (file.size > MAX_BYTES) {
      throw badRequest(`ไฟล์ "${file.name}" ใหญ่เกิน ${MAX_BYTES / 1024 / 1024} MB`);
    }

    // 2) นามสกุลในชื่อไฟล์
    const nameExt = extname(file.name).toLowerCase();
    if (nameExt && !ALLOWED_EXT.has(nameExt)) {
      throw badRequest(`นามสกุลไฟล์ไม่รองรับ: "${nameExt}" (รองรับ ${[...ALLOWED_EXT].join(", ")})`);
    }

    // 3) magic bytes (ลายเซ็นจริง)
    const buf = Buffer.from(await file.arrayBuffer());
    const realExt = sniffImageExt(buf);
    if (!realExt) {
      throw badRequest(`ไฟล์ "${file.name}" ไม่ใช่รูปภาพที่รองรับ (JPEG / PNG / WEBP / AVIF)`);
    }

    const filename = `${Date.now()}-${randomBytes(6).toString("hex")}${realExt}`;
    await writeFile(join(targetDir, filename), buf);
    saved.push({ url: `/uploads/${safeDir}/${filename}`, filename, size: file.size });
  }

  if (saved.length === 0) throw badRequest("ไม่มีไฟล์ที่ถูกต้อง");
  return saved;
}
