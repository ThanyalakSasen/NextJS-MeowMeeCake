/**
 * privateFiles — ไฟล์ที่ห้ามเปิดสาธารณะ (สลิปโอนเงิน — มีชื่อ/เลขบัญชี) · docs/uploads.md §6, BACKLOG4 Y3
 *
 * ต่างจาก upload.ts (public/uploads — Next.js เสิร์ฟ static ให้ใครก็ได้ที่รู้ URL):
 *   - localDisk: เขียนลง `<PRIVATE_UPLOAD_DIR>/<dir>/` (ค่าเริ่มต้น `storage/private`) — **อยู่นอก public/** เว็บเสิร์ฟตรงไม่ได้
 *   - s3: key `private/<dir>/<ไฟล์>` ใน bucket เดิม — ⚠️ ต้องตั้ง bucket/prefix `private/` ให้ **ไม่** public
 *   - URL ที่เก็บใน DB = `/api/files/<dir>/<ไฟล์>` → เปิดผ่าน route ที่ตรวจสิทธิ์เท่านั้น
 *     (src/app/api/files/slips/[filename]/route.ts)
 * ตรวจไฟล์ 3 ชั้นเหมือนอัปโหลดปกติ (validateFiles — ขนาด/นามสกุล/magic bytes)
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { validateFiles, randomFilename, type SavedFile } from "./upload";

export const PRIVATE_URL_PREFIX = "/api/files";
const FILE_PATTERN = "[A-Za-z0-9._-]+";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

function safeDirOf(dir: string): string {
  return dir.replace(/[^a-z0-9_-]/gi, "") || "misc";
}

function privateRoot(): string {
  const raw = process.env.PRIVATE_UPLOAD_DIR?.trim() || join("storage", "private");
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
}

const isS3Driver = () => process.env.UPLOAD_DRIVER === "s3";

async function s3() {
  const sdk = await import("@aws-sdk/client-s3");
  const client = new sdk.S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("UPLOAD_DRIVER=s3 ต้องตั้ง env S3_BUCKET");
  return { sdk, client, bucket };
}

/** url นี้เป็นไฟล์ส่วนตัวในโฟลเดอร์ `dir` ที่ระบบออกให้ไหม (`/api/files/<dir>/<ไฟล์>` — ชื่อไฟล์ห้ามมี / หรือ ..) */
export function isPrivateFileUrl(url: unknown, dir: string): boolean {
  if (typeof url !== "string") return false;
  return new RegExp(`^${PRIVATE_URL_PREFIX}/${safeDirOf(dir)}/${FILE_PATTERN}$`).test(url) && !url.includes("..");
}

/** ชื่อไฟล์จาก route param ถูกรูปแบบไหม (กัน path traversal ก่อนแตะดิสก์/bucket) */
export function isSafeFilename(name: unknown): name is string {
  return typeof name === "string" && new RegExp(`^${FILE_PATTERN}$`).test(name) && !name.includes("..");
}

export async function savePrivateImage(file: File, dir: string): Promise<SavedFile> {
  const [v] = await validateFiles([file]);
  const safeDir = safeDirOf(dir);
  const filename = randomFilename(v.ext);

  if (isS3Driver()) {
    const { sdk, client, bucket } = await s3();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: bucket,
        Key: `private/${safeDir}/${filename}`,
        Body: v.buf,
        ContentType: CONTENT_TYPES[v.ext.slice(1)] ?? "application/octet-stream",
      })
    );
  } else {
    const target = join(privateRoot(), safeDir);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, filename), v.buf);
  }
  return { url: `${PRIVATE_URL_PREFIX}/${safeDir}/${filename}`, filename, size: v.originalSize };
}

/** อ่านไฟล์ส่วนตัว — null ถ้าไม่มี (ผู้เรียกต้องตรวจสิทธิ์ก่อนเสมอ) */
export async function readPrivateFile(
  dir: string,
  filename: string
): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (!isSafeFilename(filename)) return null;
  const safeDir = safeDirOf(dir);
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  if (isS3Driver()) {
    const { sdk, client, bucket } = await s3();
    try {
      const res = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: `private/${safeDir}/${filename}` }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? { body: bytes, contentType } : null;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }
  try {
    return { body: new Uint8Array(await readFile(join(privateRoot(), safeDir, filename))), contentType };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** ลบไฟล์ส่วนตัวจาก url ที่ savePrivateImage คืน — best-effort ไม่ throw ถ้าไม่มีไฟล์ */
export async function deletePrivateFile(url: string): Promise<void> {
  const m = new RegExp(`^${PRIVATE_URL_PREFIX}/([a-z0-9_-]+)/(${FILE_PATTERN})$`, "i").exec(url);
  if (!m || !isSafeFilename(m[2])) return;
  if (isS3Driver()) {
    const { sdk, client, bucket } = await s3();
    await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: `private/${m[1]}/${m[2]}` }));
    return;
  }
  await unlink(join(privateRoot(), m[1], m[2])).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  });
}

/** ย้ายไฟล์จาก public/uploads/<dir> ไปเก็บแบบส่วนตัว (ใช้ในสคริปต์ migrate — localDisk เท่านั้น) */
export async function movePublicToPrivate(publicUrl: string, dir: string): Promise<string | null> {
  const m = new RegExp(`^/uploads/${safeDirOf(dir)}/(${FILE_PATTERN})$`).exec(publicUrl);
  if (!m || !isSafeFilename(m[1])) return null;
  const src = join(process.cwd(), "public", "uploads", safeDirOf(dir), m[1]);
  let buf: Buffer;
  try {
    buf = await readFile(src);
  } catch {
    return null; // ไม่มีไฟล์
  }
  const target = join(privateRoot(), safeDirOf(dir));
  await mkdir(target, { recursive: true });
  await writeFile(join(target, m[1]), buf);
  await unlink(src).catch(() => undefined);
  return `${PRIVATE_URL_PREFIX}/${safeDirOf(dir)}/${m[1]}`;
}
