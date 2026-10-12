import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";

/**
 * docs/DEPLOY-RENDER.md §2.1 — ย้ายไฟล์อัปโหลดจากดิสก์ (localDisk) ขึ้น S3/R2 ตอนเปลี่ยนเป็น `UPLOAD_DRIVER=s3`
 *
 * 1) ไฟล์สาธารณะ `/uploads/<dir>/<ไฟล์>` (รูปสินค้า · แบนเนอร์ · รีวิว · โลโก้ร้าน ฯลฯ)
 *    อัปโหลด public/uploads/<dir>/<ไฟล์> → `S3_BUCKET` key `<dir>/<ไฟล์>` (key เดียวกับที่ driver s3 ใช้)
 *    แล้วเปลี่ยนค่าใน DB เป็น `<S3_PUBLIC_URL_BASE>/<dir>/<ไฟล์>`
 * 2) ไฟล์ส่วนตัว `/api/files/<dir>/<ไฟล์>` (สลิป · ใบเสร็จ) — URL ใน DB ไม่เปลี่ยน
 *    อัปโหลด <PRIVATE_UPLOAD_DIR>/<dir>/<ไฟล์> → `S3_PRIVATE_BUCKET` key `private/<dir>/<ไฟล์>` (เหมือน privateFiles.ts)
 * 3) `/uploads/slips/…` · `/uploads/receipts/…` (ยังไม่ได้ย้ายเป็นไฟล์ส่วนตัว) — ไม่แตะ รายงานให้รัน
 *    `npm run migrate:upload-files -- --apply` (localDisk) ก่อน แล้วค่อยรันสคริปต์นี้ — กันสลิปหลุดไป bucket สาธารณะ
 * 4) ไฟล์จาก backend ฝั่งลูกค้าตัวเก่า (พอร์ต 4000 — customer-backend-merge.md) — ส่ง `--legacy-root=<โฟลเดอร์ public ของมัน>`:
 *    - `/products/<ไฟล์>` · `/pictures/<ไฟล์>` → `S3_BUCKET` key `<dir>/<ไฟล์>` · URL → `<S3_PUBLIC_URL_BASE>/<dir>/<ไฟล์>`
 *    - `/uploads/<dir>/<ไฟล์>` (รีวิว · โลโก้ร้าน) ที่ไม่มีใน public/uploads/ ของเรา → หาใน `<legacy-root>/uploads/<dir>/` ต่อ
 *    - `/uploads/slip-<…>` (สลิปเก่า — อยู่ใน public/uploads/ ตรง ๆ) → `S3_PRIVATE_BUCKET` key `private/slips/<ไฟล์>` ·
 *      URL → `/api/files/slips/<ไฟล์>` (เปิดผ่าน route ที่ตรวจสิทธิ์ — ไม่ขึ้น bucket สาธารณะ)
 *    ไม่ส่ง `--legacy-root` = รายงานเป็นไฟล์ที่ไม่มีบนเครื่อง ไม่แตะ
 *
 * หา URL จากทุก collection ทุกฟิลด์ (รวม array / sub-document) เทียบค่าทั้ง string ตรงตัว — ไม่ต้องไล่ชื่อฟิลด์เอง
 * ยกเว้น `userlogs` (ประวัติการใช้งาน — ไม่แก้ย้อนหลัง)
 *
 * ความปลอดภัย: ค่าเริ่มต้น dry-run (ไม่แตะ DB/bucket) · --apply สำรองค่าเดิมลง scripts/backups/ ก่อน ·
 * เปลี่ยน URL เฉพาะไฟล์ที่อัปโหลดสำเร็จ (หรือมีใน bucket แล้ว) · เขียนแบบมีเงื่อนไข (ค่ายังเป็นค่าเดิม) ·
 * ไม่ลบไฟล์บนดิสก์ · รันซ้ำได้ (URL ที่เปลี่ยนแล้วไม่ match · ไฟล์ที่มีใน bucket แล้วข้าม)
 *
 * ต้องตั้ง env: MONGODB_URI (DB ปลายทาง) + S3_ENDPOINT · S3_BUCKET · S3_PRIVATE_BUCKET · S3_PUBLIC_URL_BASE ·
 * S3_ACCESS_KEY_ID · S3_SECRET_ACCESS_KEY (ชุดเดียวกับที่ตั้งใน Render) — รันบนเครื่องที่มีโฟลเดอร์ public/uploads/
 *
 * รัน: npm run migrate:uploads-to-s3              (dry-run)
 *      npm run migrate:uploads-to-s3 -- --apply   (เขียนจริง)
 *      npm run migrate:uploads-to-s3 -- --legacy-root=<path>/backend/public [--apply]
 */

const FILE = "[A-Za-z0-9._-]+";
const MEDIA_FILE = `${FILE}\\.(?:jpe?g|png|webp|avif|mp4|mov|webm)`;
const PUBLIC_RE = new RegExp(`^/uploads/([a-z0-9_-]+)/(${FILE})$`);
const PRIVATE_RE = new RegExp(`^/api/files/([a-z0-9_-]+)/(${FILE})$`);
/** backend เก่า: รูปสินค้า `/products/…` · โลโก้ `/pictures/…` (ต้องเป็นนามสกุลรูป/วิดีโอ — กันชน path หน้าเว็บ) */
const LEGACY_PUBLIC_RE = new RegExp(`^/(products|pictures)/(${MEDIA_FILE})$`, "i");
/** backend เก่า: สลิปใน public/uploads/ ตรง ๆ */
const LEGACY_SLIP_RE = new RegExp(`^/uploads/(slip-${MEDIA_FILE})$`, "i");
/** โฟลเดอร์ที่ต้องเป็นไฟล์ส่วนตัว — ถ้ายังเป็น /uploads/<dir>/… ต้องรัน migrate:upload-files ก่อน */
const PRIVATE_DIRS = new Set(["slips", "receipts"]);
const SKIP_COLLECTIONS = new Set(["userlogs"]);

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
const contentTypeOf = (file: string) =>
  CONTENT_TYPES[file.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** ที่เก็บปลายทาง — แยกเป็น interface ให้เทสใส่ตัวปลอมได้ */
export interface ObjectStore {
  exists(bucket: string, key: string): Promise<boolean>;
  put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
}

/** S3 client ตั้งค่าเหมือน src/lib/upload.ts / privateFiles.ts */
export function createS3Store(): ObjectStore {
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
    async exists(bucket, key) {
      const { sdk, client } = await get();
      try {
        await client.send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (err) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return false;
        throw err;
      }
    },
    async put(bucket, key, body, contentType) {
      const { sdk, client } = await get();
      await client.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
  };
}

interface Ref {
  collection: string;
  _id: unknown;
  /** dotted path สำหรับ $set เช่น `product_img.0` · `media.1.url` */
  path: string;
  value: string;
}

interface FileTarget {
  local: string;
  bucket: string;
  key: string;
  refs: Ref[];
  private: boolean;
  newUrl: string | null; // null = URL ไม่เปลี่ยน (ไฟล์ส่วนตัวที่เป็น /api/files/… อยู่แล้ว)
}

/** ไฟล์บนเครื่องที่ URL นี้ชี้ (ลองตามลำดับ) + ปลายทางใน bucket */
type Plan = Omit<FileTarget, "local" | "refs"> & { candidates: string[] };

/** ไล่ทุก string ใน document (รวม array / sub-document) */
function walk(value: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (typeof value === "string") {
    out.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, path ? `${path}.${i}` : String(i), out));
  } else if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "_id" && !path) continue;
      if (k.includes(".") || k.startsWith("$")) continue; // $set ด้วย path แบบนี้ไม่ได้
      walk(v, path ? `${path}.${k}` : k, out);
    }
  }
}

export interface UploadsToS3Options {
  apply?: boolean;
  backupDir?: string;
  store?: ObjectStore;
  /** ค่าเริ่มต้น `<cwd>/public/uploads` */
  publicRoot?: string;
  /** ค่าเริ่มต้น `PRIVATE_UPLOAD_DIR` หรือ `<cwd>/storage/private` (เหมือน privateFiles.ts) */
  privateRoot?: string;
  /** โฟลเดอร์ `public` ของ backend ฝั่งลูกค้าตัวเก่า (`--legacy-root`) — ไม่ส่ง = ไม่หาไฟล์ของมัน */
  legacyRoot?: string;
  bucket?: string;
  privateBucket?: string;
  publicUrlBase?: string;
}

export interface UploadsToS3Result {
  dryRun: boolean;
  publicFiles: number;
  privateFiles: number;
  /** อัปโหลดสำเร็จ (หรือจะอัปโหลดตอน --apply) */
  uploaded: string[];
  /** มีใน bucket แล้ว — ข้าม */
  alreadyInBucket: string[];
  /** อ้างอิงใน DB แต่ไม่มีไฟล์บนดิสก์ — ไม่เปลี่ยน URL */
  missingLocal: Array<{ collection: string; _id: string; path: string; value: string }>;
  /** /uploads/slips|receipts/… — ต้องรัน migrate:upload-files ก่อน */
  needsPrivateMigration: Array<{ collection: string; _id: string; path: string; value: string }>;
  failed: Array<{ key: string; error: string }>;
  /** จำนวนค่าใน DB ที่เปลี่ยน URL (หรือจะเปลี่ยน) */
  rewritten: number;
  /** ค่าเปลี่ยนระหว่างรัน — ข้าม */
  conflicts: number;
  backupFile: string | null;
}

export async function runUploadsToS3(opts: UploadsToS3Options = {}): Promise<UploadsToS3Result> {
  const bucket = opts.bucket ?? process.env.S3_BUCKET?.trim();
  const privateBucket = opts.privateBucket ?? (process.env.S3_PRIVATE_BUCKET?.trim() || bucket);
  const base = (opts.publicUrlBase ?? process.env.S3_PUBLIC_URL_BASE ?? "").trim().replace(/\/$/, "");
  if (!bucket || !privateBucket || !base) {
    throw new Error("ต้องตั้ง env S3_BUCKET · S3_PRIVATE_BUCKET · S3_PUBLIC_URL_BASE (ชุดเดียวกับใน Render)");
  }
  const publicRoot = opts.publicRoot ?? join(process.cwd(), "public", "uploads");
  const rawPrivate = opts.privateRoot ?? (process.env.PRIVATE_UPLOAD_DIR?.trim() || join("storage", "private"));
  const privateRoot = isAbsolute(rawPrivate) ? rawPrivate : join(process.cwd(), rawPrivate);
  const legacyRoot = opts.legacyRoot;
  if (legacyRoot && !existsSync(legacyRoot)) throw new Error(`ไม่พบโฟลเดอร์ --legacy-root: ${legacyRoot}`);
  const dryRun = !opts.apply;

  /** URL นี้เป็นไฟล์ที่ต้องย้ายไหม — null = ไม่ใช่ · "needs-private" = สลิป/ใบเสร็จที่ยังเป็นไฟล์สาธารณะ */
  const planFor = (value: string): Plan | "needs-private" | null => {
    let m: RegExpExecArray | null;
    if ((m = LEGACY_SLIP_RE.exec(value))) {
      const file = m[1];
      return {
        candidates: legacyRoot ? [join(legacyRoot, "uploads", file)] : [],
        bucket: privateBucket,
        key: `private/slips/${file}`,
        private: true,
        newUrl: `/api/files/slips/${file}`,
      };
    }
    if ((m = LEGACY_PUBLIC_RE.exec(value))) {
      const [, dir, file] = m;
      return {
        candidates: legacyRoot ? [join(legacyRoot, dir, file)] : [],
        bucket,
        key: `${dir}/${file}`,
        private: false,
        newUrl: `${base}/${dir}/${file}`,
      };
    }
    if ((m = PUBLIC_RE.exec(value))) {
      const [, dir, file] = m;
      if (PRIVATE_DIRS.has(dir)) return "needs-private";
      return {
        candidates: [join(publicRoot, dir, file), ...(legacyRoot ? [join(legacyRoot, "uploads", dir, file)] : [])],
        bucket,
        key: `${dir}/${file}`,
        private: false,
        newUrl: `${base}/${dir}/${file}`,
      };
    }
    if ((m = PRIVATE_RE.exec(value))) {
      const [, dir, file] = m;
      return { candidates: [join(privateRoot, dir, file)], bucket: privateBucket, key: `private/${dir}/${file}`, private: true, newUrl: null };
    }
    return null;
  };

  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");

  const result: UploadsToS3Result = {
    dryRun,
    publicFiles: 0,
    privateFiles: 0,
    uploaded: [],
    alreadyInBucket: [],
    missingLocal: [],
    needsPrivateMigration: [],
    failed: [],
    rewritten: 0,
    conflicts: 0,
    backupFile: null,
  };
  const show = (r: Ref) => ({ collection: r.collection, _id: String(r._id), path: r.path, value: r.value });

  // ── 1) หาอ้างอิงทั้ง DB ──
  const targets = new Map<string, FileTarget>(); // key = `<bucket>/<key>`
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system.") && !SKIP_COLLECTIONS.has(n))
    .sort();
  for (const name of collections) {
    for await (const doc of db.collection(name).find({})) {
      const strings: Array<{ path: string; value: string }> = [];
      walk(doc, "", strings);
      for (const s of strings) {
        if (s.value.includes("..")) continue;
        const plan = planFor(s.value);
        if (!plan) continue;
        const ref: Ref = { collection: name, _id: doc._id, ...s };
        if (plan === "needs-private") {
          result.needsPrivateMigration.push(show(ref));
          continue;
        }
        const local = plan.candidates.find((p) => existsSync(p));
        if (!local) {
          result.missingLocal.push(show(ref));
          continue;
        }
        const id = `${plan.bucket}/${plan.key}`;
        if (!targets.has(id)) {
          const { candidates: _candidates, ...dest } = plan;
          targets.set(id, { ...dest, local, refs: [] });
        }
        targets.get(id)!.refs.push(ref);
      }
    }
  }
  const all = [...targets.values()];
  result.privateFiles = all.filter((t) => t.private).length;
  result.publicFiles = all.length - result.privateFiles;

  // ── 2) อัปโหลด ──
  const ready: FileTarget[] = [];
  if (dryRun) {
    result.uploaded = all.map((t) => `${t.bucket}/${t.key}`);
    ready.push(...all);
  } else {
    const store = opts.store ?? createS3Store();
    for (const t of all) {
      const id = `${t.bucket}/${t.key}`;
      try {
        if (await store.exists(t.bucket, t.key)) {
          result.alreadyInBucket.push(id);
        } else {
          await store.put(t.bucket, t.key, readFileSync(t.local), contentTypeOf(t.key));
          result.uploaded.push(id);
        }
        ready.push(t);
      } catch (err) {
        result.failed.push({ key: id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // ── 3) เปลี่ยน URL ใน DB (เฉพาะไฟล์สาธารณะที่อยู่ใน bucket แล้ว) ──
  const rewrites = ready.flatMap((t) => (t.newUrl ? t.refs.map((r) => ({ ...r, newUrl: t.newUrl! })) : []));
  if (dryRun) {
    result.rewritten = rewrites.length;
  } else if (rewrites.length > 0) {
    const dir = opts.backupDir ?? "scripts/backups";
    mkdirSync(dir, { recursive: true });
    result.backupFile = `${dir}/uploads-to-s3-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(
      result.backupFile,
      JSON.stringify(rewrites.map((r) => ({ collection: r.collection, _id: String(r._id), path: r.path, old: r.value, new: r.newUrl })))
    );
    for (const r of rewrites) {
      const res = await db
        .collection(r.collection)
        .updateOne({ _id: r._id as mongoose.Types.ObjectId, [r.path]: r.value }, { $set: { [r.path]: r.newUrl } });
      if (res.modifiedCount === 1) result.rewritten++;
      else result.conflicts++;
    }
  }

  // ── รายงาน ──
  console.log(`migrate-uploads-to-s3 ${dryRun ? "(DRY-RUN — ไม่ได้เขียนอะไร · ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"}`);
  console.log(`  bucket สาธารณะ: ${bucket} → ${base} · bucket ส่วนตัว: ${privateBucket}`);
  console.log(`  backend เก่า (--legacy-root): ${legacyRoot ?? "ไม่ได้ส่ง — /products/… · /pictures/… · /uploads/slip-… จะนับเป็นไฟล์ที่ไม่มี"}`);
  console.log(`  ไฟล์ที่ต้องขึ้น bucket: สาธารณะ ${result.publicFiles} · ส่วนตัว ${result.privateFiles}`);
  console.log(`  ${dryRun ? "จะอัปโหลด" : "อัปโหลดแล้ว"}: ${result.uploaded.length}${dryRun ? "" : ` · มีใน bucket แล้ว (ข้าม) ${result.alreadyInBucket.length}`}`);
  for (const f of result.failed) console.log(`    ✗ ${f.key}: ${f.error}`);
  console.log(`  ค่าใน DB ที่${dryRun ? "จะ" : ""}เปลี่ยนเป็น URL ของ bucket: ${result.rewritten}${result.conflicts ? ` · ค่าเปลี่ยนระหว่างรัน (ข้าม) ${result.conflicts}` : ""}`);
  if (result.backupFile) console.log(`  สำรองค่าเดิม: ${result.backupFile}`);
  console.log(`  อ้างอิงไฟล์ที่ไม่มีบนดิสก์ (ไม่แก้ — อัปโหลดใหม่ผ่านหลังร้าน): ${result.missingLocal.length}`);
  for (const m of result.missingLocal) console.log(`    - ${m.collection} ${m._id} ${m.path} = ${m.value}`);
  if (result.needsPrivateMigration.length > 0) {
    console.log(`  ⚠️ สลิป/ใบเสร็จที่ยังเป็นไฟล์สาธารณะ ${result.needsPrivateMigration.length} — รัน \`npm run migrate:upload-files -- --apply\` ก่อน แล้วรันสคริปต์นี้ใหม่:`);
    for (const m of result.needsPrivateMigration) console.log(`    - ${m.collection} ${m._id} ${m.path} = ${m.value}`);
  }

  return result;
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI (`npm run migrate:uploads-to-s3`)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const args = process.argv.slice(2);
  const legacyArg = args.find((a) => a.startsWith("--legacy-root="))?.slice("--legacy-root=".length)
    ?? (args.includes("--legacy-root") ? args.at(args.indexOf("--legacy-root") + 1) : undefined);
  runUploadsToS3({ apply: args.includes("--apply"), legacyRoot: legacyArg })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
