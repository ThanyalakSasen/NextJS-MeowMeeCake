/**
 * storageCleanupService — ลบไฟล์ใน S3/R2 ที่ไม่มีข้อมูลใน DB อ้างถึงแล้ว (docs/uploads.md §7)
 *
 * ไฟล์ค้างเกิดจาก: อัปโหลดรูปก่อนกดบันทึกฟอร์ม (สินค้า · แบนเนอร์ · รีวิว · สลิป · ใบเสร็จ) แล้วยกเลิก/ปิดหน้า
 * — ไฟล์ขึ้น bucket ไปแล้วแต่ไม่มี document ไหนเก็บ URL · จุดที่รู้ว่าไฟล์เลิกใช้ (แก้/ลบสินค้า เปลี่ยนแบนเนอร์/โลโก้)
 * ลบเองอยู่แล้ว (deleteImages) · ตัวนี้เก็บกวาดส่วนที่เหลือ
 *
 * ทำไมไม่ใช้ lifecycle rule ของ R2: R2 ลบตามอายุนับจากวันอัปโหลดเท่านั้น (ไม่รู้ว่าไฟล์ยังถูกใช้ไหม) — ตั้ง 60 วัน
 * = รูปสินค้า/แบนเนอร์ที่ยังขายอยู่หายไปด้วย
 *
 * ขั้นตอน:
 *   1) ไล่ทุก string ในทุก document ทุก collection (ยกเว้น userlogs — ประวัติ ไม่ใช่การใช้งาน) เก็บ `<โฟลเดอร์>/<ไฟล์>`
 *      ทุกจุดที่เจอ — ไม่ผูกกับโดเมน (S3_PUBLIC_URL_BASE เปลี่ยนเป็น custom domain ได้โดยของเดิมไม่ถูกลบ) และนับ
 *      `/uploads/…` · `/api/files/…` ด้วย · รายการที่ถูก soft delete ยังนับว่าใช้อยู่ (กู้คืนได้)
 *   2) ไล่ object ใน S3_BUCKET + S3_PRIVATE_BUCKET — สนใจเฉพาะ key รูปแบบที่ระบบสร้าง (`<dir>/<ไฟล์>` · `private/<dir>/<ไฟล์>`
 *      นามสกุลรูป/วิดีโอ) · key อื่นไม่แตะ
 *   3) ลบเฉพาะที่ "ไม่มีใครอ้างถึง" และ "อัปโหลดมานานกว่า minAgeDays" (ค่าเริ่มต้น 60 วัน — กันไฟล์ที่เพิ่งอัปโหลดรอกดบันทึก)
 *
 * ความปลอดภัย: ค่าเริ่มต้น dry-run · อ่าน DB ไม่สำเร็จ = throw ก่อนลบ · ไม่เจอการอ้างถึงเลยสักไฟล์ = หยุด ไม่ลบ ·
 * ลบไม่เกิน maxDelete ต่อรอบ (เก่าสุดก่อน — ที่เหลือรอบหน้า) · ใช้ได้เฉพาะ UPLOAD_DRIVER=s3 (localDisk ใช้ cleanup:review-media)
 */
import mongoose from "mongoose";
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";

export const DEFAULT_MIN_AGE_DAYS = 60;
/** ต่ำกว่านี้เสี่ยงลบไฟล์ที่ผู้ใช้กำลังกรอกฟอร์มค้างอยู่ */
export const MIN_AGE_DAYS_FLOOR = 7;
export const DEFAULT_MAX_DELETE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_CONCURRENCY = 10;
const SKIP_COLLECTIONS = new Set(["userlogs"]);

const MEDIA_EXT = "(?:jpe?g|png|webp|avif|mp4|mov|webm)";
const FILE = `[A-Za-z0-9_-][A-Za-z0-9._-]*\\.${MEDIA_EXT}`;
/** `<dir>/<ไฟล์>` ที่ฝังอยู่ใน string ใด ๆ (URL เต็ม · path · ข้อความ) */
const REF_RE = new RegExp(`([a-z0-9_-]+)/(${FILE})(?![A-Za-z0-9._-])`, "gi");
/** key ที่ระบบสร้าง: `<dir>/<ไฟล์>` (upload.ts) · `private/<dir>/<ไฟล์>` (privateFiles.ts) */
const KEY_RE = new RegExp(`^(?:private/)?([a-z0-9_-]+/${FILE})$`, "i");

export interface StoredObject {
  key: string;
  lastModified: Date;
  size: number;
}

/** ที่เก็บไฟล์ — แยกเป็น interface ให้เทสใส่ตัวปลอมได้ */
export interface CleanupStore {
  list(bucket: string): AsyncIterable<StoredObject>;
  remove(bucket: string, key: string): Promise<void>;
}

/** S3 client ตั้งค่าเหมือน src/lib/upload.ts / privateFiles.ts */
export function createS3CleanupStore(): CleanupStore {
  let clientPromise: Promise<{
    sdk: typeof import("@aws-sdk/client-s3");
    client: import("@aws-sdk/client-s3").S3Client;
  }> | null = null;
  const get = () =>
    (clientPromise ??= import("@aws-sdk/client-s3").then((sdk) => ({
      sdk,
      client: new sdk.S3Client({
        region: process.env.S3_REGION || "auto",
        endpoint: process.env.S3_ENDPOINT || undefined,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        },
      }),
    })));
  return {
    async *list(bucket) {
      const { sdk, client } = await get();
      let token: string | undefined;
      do {
        const res = await client.send(new sdk.ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
        for (const o of res.Contents ?? []) {
          if (o.Key && o.LastModified) yield { key: o.Key, lastModified: o.LastModified, size: o.Size ?? 0 };
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
    },
    async remove(bucket, key) {
      const { sdk, client } = await get();
      await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** ไล่ทุก string ใน document (รวม array / sub-document) */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

/** `<dir>/<ไฟล์>` ทุกตัวที่ DB อ้างถึง */
export async function collectReferencedFiles(): Promise<Set<string>> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const refs = new Set<string>();
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system.") && !SKIP_COLLECTIONS.has(n));
  for (const name of collections) {
    for await (const doc of db.collection(name).find({})) {
      const strings: string[] = [];
      collectStrings(doc, strings);
      for (const s of strings) {
        for (const m of s.matchAll(REF_RE)) refs.add(`${m[1]}/${m[2]}`);
      }
    }
  }
  return refs;
}

export interface StorageCleanupOptions {
  apply?: boolean;
  minAgeDays?: number;
  maxDelete?: number;
  now?: number;
  store?: CleanupStore;
  bucket?: string;
  privateBucket?: string;
}

export interface StorageCleanupResult {
  dryRun: boolean;
  /** เหตุผลที่ไม่ได้ทำงาน (ไม่ใช่ s3 · ไม่เจอการอ้างถึงเลย) */
  skipped: string | null;
  minAgeDays: number;
  /** จำนวนไฟล์ที่ DB อ้างถึง */
  referenced: number;
  /** object ทั้งหมดใน bucket */
  scanned: number;
  inUse: number;
  /** ไม่มีใครอ้างถึงแต่ยังใหม่กว่า minAgeDays — รอรอบหน้า */
  tooNew: number;
  /** key ที่ไม่ใช่รูปแบบที่ระบบสร้าง — ไม่แตะ */
  ignored: number;
  /** ไม่มีใครอ้างถึง + เก่าพอ (ทั้งหมด ก่อนตัดตาม maxDelete) */
  unused: number;
  /** `<bucket>/<key>` ที่ลบแล้ว (dry-run = ที่จะลบ) */
  deleted: string[];
  deletedBytes: number;
  /** เกิน maxDelete — ลบรอบหน้า */
  remaining: number;
  failed: Array<{ key: string; error: string }>;
}

export async function cleanupUnusedUploads(opts: StorageCleanupOptions = {}): Promise<StorageCleanupResult> {
  const minAgeDays = opts.minAgeDays ?? DEFAULT_MIN_AGE_DAYS;
  if (!(minAgeDays >= MIN_AGE_DAYS_FLOOR)) throw new Error(`minAgeDays ต้องไม่น้อยกว่า ${MIN_AGE_DAYS_FLOOR} วัน`);
  const maxDelete = opts.maxDelete ?? DEFAULT_MAX_DELETE;
  const now = opts.now ?? Date.now();
  const result: StorageCleanupResult = {
    dryRun: !opts.apply,
    skipped: null,
    minAgeDays,
    referenced: 0,
    scanned: 0,
    inUse: 0,
    tooNew: 0,
    ignored: 0,
    unused: 0,
    deleted: [],
    deletedBytes: 0,
    remaining: 0,
    failed: [],
  };

  const bucket = opts.bucket ?? process.env.S3_BUCKET?.trim();
  const privateBucket = opts.privateBucket ?? (process.env.S3_PRIVATE_BUCKET?.trim() || bucket);
  if (!opts.store && process.env.UPLOAD_DRIVER !== "s3") {
    result.skipped = "UPLOAD_DRIVER ไม่ใช่ s3 — ไฟล์อยู่บนดิสก์ (ใช้ npm run cleanup:review-media)";
    return result;
  }
  if (!bucket || !privateBucket) throw new Error("ต้องตั้ง env S3_BUCKET (และ S3_PRIVATE_BUCKET ถ้าแยก bucket)");

  // อ่าน DB ให้เสร็จก่อนแตะ bucket — อ่านไม่สำเร็จ = throw ออกไปโดยยังไม่ได้ลบอะไร
  const refs = await collectReferencedFiles();
  result.referenced = refs.size;
  if (refs.size === 0) {
    result.skipped = "ไม่พบไฟล์ที่ DB อ้างถึงเลย — หยุดไว้ก่อน (DB ว่าง/ต่อผิดที่?) ไม่ลบอะไร";
    log.warn("storage_cleanup.no_references", {});
    return result;
  }

  const store = opts.store ?? createS3CleanupStore();
  const cutoff = now - minAgeDays * DAY_MS;
  const candidates: Array<{ bucket: string; obj: StoredObject }> = [];
  for (const b of [...new Set([bucket, privateBucket])]) {
    for await (const obj of store.list(b)) {
      result.scanned++;
      const m = KEY_RE.exec(obj.key);
      if (!m) result.ignored++;
      else if (refs.has(m[1])) result.inUse++;
      else if (obj.lastModified.getTime() > cutoff) result.tooNew++;
      else candidates.push({ bucket: b, obj });
    }
  }
  result.unused = candidates.length;

  candidates.sort((a, b) => a.obj.lastModified.getTime() - b.obj.lastModified.getTime());
  const batch = candidates.slice(0, maxDelete);
  result.remaining = candidates.length - batch.length;

  if (result.dryRun) {
    result.deleted = batch.map((c) => `${c.bucket}/${c.obj.key}`);
    result.deletedBytes = batch.reduce((n, c) => n + c.obj.size, 0);
    return result;
  }

  for (let i = 0; i < batch.length; i += DELETE_CONCURRENCY) {
    await Promise.all(
      batch.slice(i, i + DELETE_CONCURRENCY).map(async (c) => {
        const id = `${c.bucket}/${c.obj.key}`;
        try {
          await store.remove(c.bucket, c.obj.key);
          result.deleted.push(id);
          result.deletedBytes += c.obj.size;
        } catch (err) {
          result.failed.push({ key: id, error: err instanceof Error ? err.message : String(err) });
        }
      })
    );
  }
  log.info("storage_cleanup.done", {
    deleted: result.deleted.length,
    deleted_bytes: result.deletedBytes,
    failed: result.failed.length,
    remaining: result.remaining,
  });
  return result;
}
