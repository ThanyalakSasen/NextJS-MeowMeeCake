import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";

/**
 * docs/BACKLOG4.md §7.15 — ลบฟิลด์ schema เก่า `delete_at` (สะกดผิดของ deleted_at) ที่ค้างในสินค้า
 * ไม่งั้น check:data-integrity (Y11) จะแจ้ง legacy_fields ทุกเช้า
 *
 * ลบเฉพาะ `delete_at: null` (ไม่มีความหมายอะไร) · ถ้ามีค่าเป็นวันที่ = อาจหมายถึง "ถูกลบ" ตาม schema เก่า → รายงาน ไม่แตะ
 * (product_type / product_types ไม่ใช่งานของสคริปต์นี้ — ใช้ migrate:is-preorder)
 *
 * ความปลอดภัย: dry-run ค่าเริ่มต้น · --apply backup scripts/backups/legacy-product-fields-*.json ก่อน ·
 * เขียนแบบมีเงื่อนไข { _id, delete_at: null } · ไม่แตะ updated_at · รันซ้ำได้
 *
 * รัน: npm run cleanup:legacy-product-fields              (dry-run)
 *      npm run cleanup:legacy-product-fields -- --apply   (เขียนจริง)
 */

export interface LegacyCleanupResult {
  dryRun: boolean;
  planned: Array<{ _id: string; product_id: string | null }>;
  /** delete_at มีค่า (ไม่ใช่ null) — ไม่แตะ ต้องตัดสินใจเอง */
  needsReview: Array<{ _id: string; product_id: string | null; delete_at: unknown }>;
  removed: number;
  backupFile: string | null;
}

export async function runCleanup(opts: { apply?: boolean; backupDir?: string } = {}): Promise<LegacyCleanupResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const products = db.collection("products");
  const dryRun = !opts.apply;

  const docs = await products.find({ delete_at: { $exists: true } }).project({ product_id: 1, delete_at: 1 }).toArray();
  const planned: LegacyCleanupResult["planned"] = [];
  const needsReview: LegacyCleanupResult["needsReview"] = [];
  for (const d of docs) {
    const row = { _id: String(d._id), product_id: (d.product_id as string) ?? null };
    if (d.delete_at === null) planned.push(row);
    else needsReview.push({ ...row, delete_at: d.delete_at });
  }

  let removed = 0;
  let backupFile: string | null = null;
  if (!dryRun && planned.length) {
    const dir = opts.backupDir ?? "scripts/backups";
    mkdirSync(dir, { recursive: true });
    backupFile = `${dir}/legacy-product-fields-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(backupFile, JSON.stringify(planned.map((p) => ({ ...p, delete_at: null })), null, 2));
    for (const p of planned) {
      const res = await products.updateOne(
        { _id: new mongoose.Types.ObjectId(p._id), delete_at: null },
        { $unset: { delete_at: "" } }
      );
      removed += res.modifiedCount;
    }
  }

  console.log(`cleanup-legacy-product-fields ${dryRun ? "(DRY-RUN — ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"}`);
  console.log(`  ลบ delete_at: null ได้: ${planned.length} ตัว — ${planned.map((p) => p.product_id ?? p._id).join(", ") || "-"}`);
  if (needsReview.length) {
    console.log(`  delete_at มีค่า (ไม่แตะ — ตรวจเองว่าตั้งใจลบสินค้านี้ไหม): ${needsReview.length}`);
    for (const r of needsReview) console.log(`    - ${r.product_id ?? r._id}: ${JSON.stringify(r.delete_at)}`);
  }
  if (!dryRun) console.log(`  ลบสำเร็จ: ${removed}${backupFile ? ` · backup: ${backupFile}` : ""}`);

  return { dryRun, planned, needsReview, removed, backupFile };
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runCleanup({ apply: process.argv.includes("--apply") })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
