/**
 * upload — ตัวช่วยรับไฟล์รูปจาก multipart/form-data แล้วบันทึก + ลบผ่าน driver ที่เลือกได้
 *
 * ตรวจ 3 ชั้นก่อนบันทึกเสมอ ไม่ว่าจะใช้ driver ไหน: ขนาด → นามสกุลไฟล์ → magic bytes
 * (ลายเซ็นไฟล์จริง) — ไม่เชื่อ MIME จาก client
 *
 * BACKLOG §3.13 — เลือก driver ผ่าน env `UPLOAD_DRIVER`:
 *   - "localDisk" (ดีฟอลต์) — เขียนลง public/uploads/<dir>/ คืน url ที่ Next.js serve static ได้เลย
 *     ⚠️ ใช้ได้เฉพาะตอน self-host (VPS/เครื่องตัวเอง) — บน serverless (Vercel ฯลฯ) public/ เป็น
 *     read-only ตอน runtime และไฟล์ที่เขียนจะหายเมื่อ instance รีสตาร์ท
 *   - "s3" — S3-compatible object storage (AWS S3 / Cloudflare R2 / GCS ผ่าน interop API)
 *     ต้องตั้ง env เพิ่ม: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *     S3_PUBLIC_URL_BASE (โดเมนอ่านไฟล์กลับ เช่น CDN หรือ bucket public url), S3_ENDPOINT
 *     (ใส่เมื่อใช้ R2/GCS แทน AWS จริง — ดู docs/env.md)
 *
 * ทุก driver ต้อง implement UploadDriver เดียวกัน (save + delete) — สลับ driver ไม่ต้องแก้โค้ดที่เรียกใช้
 * (`saveImages`/`deleteImages`) เลย ดู docs/env.md
 */
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { badRequest } from "./httpError";
import { log } from "./logger";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB ต่อไฟล์
const MAX_FILES = 8;
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

export interface SavedFile {
  url: string;
  filename: string;
  size: number;
}

export interface UploadDriver {
  save(files: File[], dir: string): Promise<SavedFile[]>;
  /** ลบไฟล์จาก url ที่ save() เคยคืนมา — ไม่ throw (caller คาดหวัง best-effort เสมอ ดู deleteImages) */
  delete(url: string): Promise<void>;
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

interface ValidatedFile {
  buf: Buffer;
  ext: string;
  originalSize: number;
}

/** ตรวจไฟล์ 3 ชั้น (ใช้ร่วมกันทุก driver — ไม่ให้ driver ไหนหลุดการตรวจ) */
async function validateFiles(files: File[]): Promise<ValidatedFile[]> {
  if (!Array.isArray(files) || files.length === 0) {
    throw badRequest("ไม่พบไฟล์ที่อัปโหลด");
  }
  if (files.length > MAX_FILES) {
    throw badRequest(`อัปโหลดได้สูงสุด ${MAX_FILES} ไฟล์ต่อครั้ง`);
  }

  const out: ValidatedFile[] = [];
  for (const file of files) {
    if (!(file instanceof File)) continue;

    if (file.size > MAX_BYTES) {
      throw badRequest(`ไฟล์ "${file.name}" ใหญ่เกิน ${MAX_BYTES / 1024 / 1024} MB`);
    }

    const nameExt = extname(file.name).toLowerCase();
    if (nameExt && !ALLOWED_EXT.has(nameExt)) {
      throw badRequest(`นามสกุลไฟล์ไม่รองรับ: "${nameExt}" (รองรับ ${[...ALLOWED_EXT].join(", ")})`);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const realExt = sniffImageExt(buf);
    if (!realExt) {
      throw badRequest(`ไฟล์ "${file.name}" ไม่ใช่รูปภาพที่รองรับ (JPEG / PNG / WEBP / AVIF)`);
    }

    out.push({ buf, ext: realExt, originalSize: file.size });
  }

  if (out.length === 0) throw badRequest("ไม่มีไฟล์ที่ถูกต้อง");
  return out;
}

function randomFilename(ext: string): string {
  return `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
}

// ── driver: local disk (ดีฟอลต์ — self-host เท่านั้น) ──────────
const localDiskDriver: UploadDriver = {
  async save(files, dir) {
    const validated = await validateFiles(files);
    const safeDir = dir.replace(/[^a-z0-9_-]/gi, "") || "misc";
    const targetDir = join(process.cwd(), "public", "uploads", safeDir);
    await mkdir(targetDir, { recursive: true });

    const saved: SavedFile[] = [];
    for (const v of validated) {
      const filename = randomFilename(v.ext);
      await writeFile(join(targetDir, filename), v.buf);
      saved.push({ url: `/uploads/${safeDir}/${filename}`, filename, size: v.originalSize });
    }
    return saved;
  },

  async delete(url) {
    // ต้องตรง pattern ที่ save() ของ driver นี้สร้างเองเท่านั้น (กัน path traversal จาก url แปลกปลอม)
    const m = /^\/uploads\/([a-z0-9_-]+)\/([^/\\]+)$/i.exec(url);
    if (!m) return;
    const filePath = join(process.cwd(), "public", "uploads", m[1], m[2]);
    await unlink(filePath).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    });
  },
};

// ── driver: S3-compatible (AWS S3 / Cloudflare R2 / GCS interop) ──
function createS3Driver(): UploadDriver {
  // lazy import: กัน @aws-sdk/client-s3 ถูกโหลดตอน dev/build ทั้งที่ localDisk (ดีฟอลต์) ไม่ต้องใช้เลย
  let clientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
  async function getClient() {
    if (!clientPromise) {
      clientPromise = import("@aws-sdk/client-s3").then(
        ({ S3Client }) =>
          new S3Client({
            region: process.env.S3_REGION || "auto",
            endpoint: process.env.S3_ENDPOINT || undefined,
            credentials: {
              accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
            },
          })
      );
    }
    return clientPromise;
  }

  function keyFromUrl(url: string): string | null {
    const base = (process.env.S3_PUBLIC_URL_BASE || "").replace(/\/$/, "");
    if (base && url.startsWith(`${base}/`)) return url.slice(base.length + 1);
    return null;
  }

  return {
    async save(files, dir) {
      const validated = await validateFiles(files);
      const bucket = process.env.S3_BUCKET;
      if (!bucket) throw new Error("UPLOAD_DRIVER=s3 ต้องตั้ง env S3_BUCKET");
      const base = (process.env.S3_PUBLIC_URL_BASE || "").replace(/\/$/, "");
      const safeDir = dir.replace(/[^a-z0-9_-]/gi, "") || "misc";

      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await getClient();

      const saved: SavedFile[] = [];
      for (const v of validated) {
        const filename = randomFilename(v.ext);
        const key = `${safeDir}/${filename}`;
        const extNoDot = v.ext.slice(1);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: v.buf,
            ContentType: `image/${extNoDot === "jpg" ? "jpeg" : extNoDot}`,
          })
        );
        saved.push({ url: base ? `${base}/${key}` : key, filename, size: v.originalSize });
      }
      return saved;
    },

    async delete(url) {
      const key = keyFromUrl(url);
      const bucket = process.env.S3_BUCKET;
      if (!key || !bucket) return; // url ไม่ตรง pattern ของ driver นี้ หรือยังไม่ตั้ง bucket → ข้าม
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await getClient();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

let driverInstance: UploadDriver | null = null;
function getDriver(): UploadDriver {
  if (!driverInstance) {
    driverInstance = process.env.UPLOAD_DRIVER === "s3" ? createS3Driver() : localDiskDriver;
  }
  return driverInstance;
}

/**
 * รับ File[] (จาก formData.getAll(...)) บันทึกเป็นรูปผ่าน driver ที่เลือกไว้ (env `UPLOAD_DRIVER`)
 * คืนรายการ url
 * @param dir โฟลเดอร์ย่อย/prefix (จะถูก sanitize เหลือ [a-z0-9_-])
 */
export async function saveImages(files: File[], dir: string): Promise<SavedFile[]> {
  return getDriver().save(files, dir);
}

/**
 * BACKLOG §3.14 — ลบไฟล์รูปที่ไม่ใช้แล้ว (เช่นตอนแก้ไข/ลบสินค้า) best-effort เสมอ — ไม่ throw
 * ถ้าลบไม่สำเร็จ แค่ log ไว้ (caller ไม่ต้องห่อ .catch() เองอีกชั้น)
 */
export async function deleteImages(urls: string[]): Promise<void> {
  const driver = getDriver();
  await Promise.all(
    urls.map((url) =>
      driver.delete(url).catch((err) => log.error("upload.delete_failed", { url, err }))
    )
  );
}
