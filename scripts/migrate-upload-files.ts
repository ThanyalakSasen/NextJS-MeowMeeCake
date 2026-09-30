import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import { isUploadedUrl, saveImages, UPLOAD_DIRS } from "../src/lib/upload";
import { isPrivateFileUrl, movePublicToPrivate, readPrivateFile } from "../src/lib/privateFiles";

/**
 * docs/uploads.md — ย้ายรูปที่เก็บผิดที่ให้เป็นไฟล์จริงใน public/uploads/<โฟลเดอร์> + ตรวจอ้างอิงที่เสีย
 *
 * 1) banners.banner_img (แก้ให้) — base64 (`data:image/...`) ก้อนละหลาย MB ที่ค้างอยู่ใน DB ตั้งแต่ก่อน
 *    BACKLOG2 §15 และลิงก์รูปภายนอก (http/https) → เขียนเป็นไฟล์ใน public/uploads/banners/ ผ่าน saveImages()
 *    (ตรวจ magic bytes เหมือนอัปโหลดปกติ) แล้วเปลี่ยน banner_img เป็น /uploads/banners/<ไฟล์>
 *    ทำทั้งแบนเนอร์ที่ใช้งานและที่ถูกลบ (soft delete — กู้คืนได้ + ลดขนาด DB)
 * 2) payments.slip_image_url — สลิปที่อยู่ใน public/uploads/slips ย้ายเป็นไฟล์ส่วนตัว (storage/private/slips ·
 *    URL เป็น /api/files/slips/… — BACKLOG4 Y3) · expenses.receipt_url + สลิปที่ไม่มีไฟล์ (รายงานอย่างเดียว ไม่แก้) · — ค่าที่ไม่ใช่ไฟล์ของระบบ
 *    หรือชี้ไฟล์ที่ไม่มีอยู่จริงบนดิสก์ (กู้ไฟล์กลับไม่ได้ ต้องให้ลูกค้า/แอดมินแนบใหม่)
 *
 * ความปลอดภัย: ค่าเริ่มต้น dry-run (อ่านอย่างเดียว) · --apply สำรองค่าเดิมลง scripts/backups/ ก่อน ·
 * เขียนทีละแถวแบบมีเงื่อนไข (banner_img ต้องยังเป็นค่าเดิม) · แปลงไม่ได้ (ไม่ใช่รูป/โหลดไม่ได้) → ข้าม+รายงาน
 * รันซ้ำได้ (แถวที่เป็นไฟล์ของระบบแล้วไม่ถูกแตะ)
 *
 * รัน: npm run migrate:upload-files              (dry-run)
 *      npm run migrate:upload-files -- --apply   (เขียนจริง)
 */

type Kind = "data-uri" | "external-url" | "uploaded" | "empty" | "other";

function kindOf(v: unknown, dir: string): Kind {
  if (v == null || v === "") return "empty";
  if (typeof v !== "string") return "other";
  if (isUploadedUrl(v, dir)) return "uploaded";
  if (v.startsWith("data:")) return "data-uri";
  if (/^https?:\/\//i.test(v)) return "external-url";
  return "other";
}

/** ไฟล์ localDisk มีอยู่จริงไหม (driver s3 ตรวจไม่ได้ → ถือว่ามี) */
function localFileExists(url: string): boolean {
  if (process.env.UPLOAD_DRIVER === "s3") return true;
  if (!url.startsWith("/uploads/")) return false;
  return existsSync(join(process.cwd(), "public", ...url.split("/").filter(Boolean)));
}

async function loadImage(value: string): Promise<{ buf: Buffer; name: string }> {
  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    if (comma < 0 || !value.slice(0, comma).includes(";base64")) throw new Error("data URI ไม่ใช่ base64");
    return { buf: Buffer.from(value.slice(comma + 1), "base64"), name: "banner" };
  }
  const res = await fetch(value, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`ดาวน์โหลดไม่ได้ (HTTP ${res.status})`);
  return { buf: Buffer.from(await res.arrayBuffer()), name: "banner" };
}

export interface UploadFilesMigrationResult {
  dryRun: boolean;
  banners: {
    planned: Array<{ _id: string; kind: Kind; bytes: number; deleted: boolean }>;
    converted: Array<{ _id: string; url: string }>;
    failed: Array<{ _id: string; error: string }>;
    missingFile: Array<{ _id: string; url: string; deleted: boolean }>;
  };
  slips: Array<{ _id: string; value: string; problem: "not-uploaded" | "missing-file"; status: string }>;
  /** สลิปใน public/uploads/slips ที่ย้าย (หรือจะย้ายตอน --apply) ไปเป็นไฟล์ส่วนตัว */
  slipsToPrivate: Array<{ _id: string; from: string }>;
  receipts: Array<{ _id: string; value: string; problem: "not-uploaded" | "missing-file"; deleted: boolean }>;
  backupFile: string | null;
}

export async function runMigration(
  opts: { apply?: boolean; backupDir?: string } = {}
): Promise<UploadFilesMigrationResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const dryRun = !opts.apply;

  // ── 1) banners ──
  const bannerCol = db.collection("banners");
  const banners = await bannerCol.find({}, { projection: { banner_img: 1, deleted_at: 1 } }).toArray();
  const result: UploadFilesMigrationResult = {
    dryRun,
    banners: { planned: [], converted: [], failed: [], missingFile: [] },
    slips: [],
    slipsToPrivate: [],
    receipts: [],
    backupFile: null,
  };
  const toConvert: Array<{ _id: mongoose.Types.ObjectId; old: string }> = [];
  for (const b of banners) {
    const kind = kindOf(b.banner_img, UPLOAD_DIRS.banners);
    const deleted = !!b.deleted_at;
    if (kind === "data-uri" || kind === "external-url") {
      result.banners.planned.push({ _id: String(b._id), kind, bytes: String(b.banner_img).length, deleted });
      toConvert.push({ _id: b._id, old: b.banner_img });
    } else if (kind === "uploaded" && !localFileExists(b.banner_img)) {
      result.banners.missingFile.push({ _id: String(b._id), url: b.banner_img, deleted });
    }
  }

  if (!dryRun && toConvert.length > 0) {
    const dir = opts.backupDir ?? "scripts/backups";
    mkdirSync(dir, { recursive: true });
    result.backupFile = `${dir}/banner-images-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(result.backupFile, JSON.stringify(toConvert.map((t) => ({ _id: String(t._id), banner_img: t.old }))));

    for (const t of toConvert) {
      try {
        const { buf, name } = await loadImage(t.old);
        const [saved] = await saveImages([new File([new Uint8Array(buf)], name)], UPLOAD_DIRS.banners);
        const res = await bannerCol.updateOne({ _id: t._id, banner_img: t.old }, { $set: { banner_img: saved.url } });
        if (res.modifiedCount === 1) result.banners.converted.push({ _id: String(t._id), url: saved.url });
        else result.banners.failed.push({ _id: String(t._id), error: "banner_img เปลี่ยนระหว่างรัน — ข้าม" });
      } catch (err) {
        result.banners.failed.push({ _id: String(t._id), error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // ── 2) slips — ย้ายสลิปที่เคยเก็บใน public/uploads/slips เป็นไฟล์ส่วนตัว (BACKLOG4 Y3) + รายงานที่ไม่มีไฟล์ ──
  const paymentCol = db.collection("payments");
  const slips = await paymentCol
    .find({ slip_image_url: { $nin: [null, ""] }, deleted_at: null }, { projection: { slip_image_url: 1, status: 1 } })
    .toArray();
  for (const p of slips) {
    const v = String(p.slip_image_url);
    if (isPrivateFileUrl(v, UPLOAD_DIRS.slips)) {
      const file = v.split("/").pop() ?? "";
      if (!(await readPrivateFile(UPLOAD_DIRS.slips, file))) {
        result.slips.push({ _id: String(p._id), value: v, problem: "missing-file", status: p.status });
      }
    } else if (isUploadedUrl(v, UPLOAD_DIRS.slips) && localFileExists(v)) {
      result.slipsToPrivate.push({ _id: String(p._id), from: v });
      if (!dryRun) {
        const to = await movePublicToPrivate(v, UPLOAD_DIRS.slips);
        if (to) await paymentCol.updateOne({ _id: p._id, slip_image_url: v }, { $set: { slip_image_url: to } });
      }
    } else {
      result.slips.push({ _id: String(p._id), value: v, problem: isUploadedUrl(v, UPLOAD_DIRS.slips) ? "missing-file" : "not-uploaded", status: p.status });
    }
  }
  const receipts = await db
    .collection("expenses")
    .find({ receipt_url: { $nin: [null, ""] } }, { projection: { receipt_url: 1, deleted_at: 1 } })
    .toArray();
  for (const e of receipts) {
    const v = String(e.receipt_url);
    const deleted = !!e.deleted_at;
    if (!isUploadedUrl(v, UPLOAD_DIRS.receipts)) result.receipts.push({ _id: String(e._id), value: v, problem: "not-uploaded", deleted });
    else if (!localFileExists(v)) result.receipts.push({ _id: String(e._id), value: v, problem: "missing-file", deleted });
  }

  // ── รายงาน ──
  const b = result.banners;
  console.log(`migrate-upload-files ${dryRun ? "(DRY-RUN — ไม่ได้เขียนอะไร · ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"}`);
  console.log(`  banners: ต้องย้ายเป็นไฟล์ ${b.planned.length} (base64 ${b.planned.filter((p) => p.kind === "data-uri").length} · ลิงก์ภายนอก ${b.planned.filter((p) => p.kind === "external-url").length})`);
  for (const p of b.planned) console.log(`    - ${p._id} ${p.kind} ${(p.bytes / 1024).toFixed(0)} KB${p.deleted ? " [ถูกลบ]" : ""}`);
  if (!dryRun) {
    console.log(`    ย้ายสำเร็จ ${b.converted.length} · ไม่สำเร็จ ${b.failed.length}`);
    for (const f of b.failed) console.log(`      ✗ ${f._id}: ${f.error}`);
    if (result.backupFile) console.log(`    สำรองค่าเดิม: ${result.backupFile}`);
  }
  console.log(`  banners ที่ชี้ไฟล์ซึ่งไม่มีจริง: ${b.missingFile.length}`);
  for (const m of b.missingFile) console.log(`    - ${m._id} ${m.url}${m.deleted ? " [ถูกลบ]" : ""}`);
  console.log(`  สลิปใน public/uploads/slips → ย้ายเป็นไฟล์ส่วนตัว (/api/files/slips/…)${dryRun ? " (จะย้าย)" : ""}: ${result.slipsToPrivate.length}`);
  console.log(`  สลิปโอนเงินที่ไม่มีไฟล์จริง (ไม่แก้ — ให้ลูกค้าแนบใหม่): ${result.slips.length}`);
  for (const s of result.slips) console.log(`    - payment ${s._id} [${s.status}] ${s.value} (${s.problem})`);
  console.log(`  ใบเสร็จค่าใช้จ่ายที่ไม่มีไฟล์จริง (ไม่แก้ — แนบใหม่ผ่านหน้าค่าใช้จ่าย): ${result.receipts.length}`);
  for (const r of result.receipts) console.log(`    - expense ${r._id} ${r.value} (${r.problem})${r.deleted ? " [ถูกลบ]" : ""}`);

  return result;
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI (`npm run migrate:upload-files`)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runMigration({ apply: process.argv.includes("--apply") })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
