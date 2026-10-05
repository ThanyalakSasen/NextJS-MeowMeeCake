import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import { isPreorderOf, productCodePrefix } from "../src/lib/productCode";

/**
 * docs/BACKLOG2.md §14 (แก้ 2026-09-30) — เลิกแยกประเภทสินค้าตามช่องทางขาย ย้ายข้อมูลประเภทสินค้าทุกรุ่น
 * ให้เหลือฟิลด์ boolean `is_preorder` ตัวเดียว (ช่องทางขายดูจากเลขออเดอร์ ORD-/POS-/PRE- แทน):
 *   product_types: ["preorder"]              → is_preorder: true
 *   product_types: ["inStore"/"online"...]   → is_preorder: false
 *   product_type: "preorder" (รุ่นแรก)       → is_preorder: true
 *   product_type: "inStore"/"online"/"ready" → is_preorder: false
 * แล้ว $unset product_types + product_type ทิ้ง (ทั้งสองรุ่นเลิกใช้แล้ว)
 *
 * ต้องรันก่อน deploy โค้ดที่ใช้ is_preorder — ไม่งั้นสินค้าพรีออเดอร์เดิม (ยังไม่มีฟิลด์) จะถูกอ่านเป็น
 * สินค้าปกติ (schema default false): ลูกค้าหยิบใส่ตะกร้าได้ / เพิ่มเข้ารอบพรีออเดอร์ไม่ได้ / นับเป็นสินค้ามีสต็อก
 *
 * ความปลอดภัย:
 *   - ค่าเริ่มต้น = dry-run (อ่านอย่างเดียว พิมพ์แผน) · เขียนจริงต้องส่ง --apply
 *   - --apply: สำรองค่าเดิมของทุกเอกสารที่จะแก้ลง scripts/backups/is-preorder-<เวลา UTC>.json ก่อน
 *   - เขียนทีละเอกสารแบบมีเงื่อนไข (_id + ค่าเดิมของ product_types/product_type ต้องยังเหมือนตอนอ่าน)
 *     → มีใครแก้ระหว่างรัน = ข้ามเอกสารนั้น (นับเป็น conflict) ไม่เขียนทับ
 *   - ตัดสินประเภทไม่ได้ (ไม่มีฟิลด์ประเภทที่ใช้ได้เลย) → ไม่แตะ รายงานให้แก้มือ
 *   - รันซ้ำได้: เอกสารที่มี is_preorder แล้วและไม่มีฟิลด์เก่าค้าง ถือว่าเสร็จแล้ว ข้าม
 *
 * รายงาน (ไม่แก้) สินค้าที่ prefix ของ product_id ไม่ตรงประเภท — การเปลี่ยนรหัสกระทบบาร์โค้ด/ป้ายที่พิมพ์แล้ว
 * ให้แอดมินแก้ผ่าน PATCH /api/admin/products/[id] { is_preorder: <ค่าเดิม> } (updateProduct สร้างรหัสใหม่ให้)
 *
 * รัน: npm run migrate:is-preorder              (dry-run)
 *      npm run migrate:is-preorder -- --apply   (เขียนจริง)
 */

type LegacyFields = { product_types?: unknown; product_type?: unknown };

export interface IsPreorderMigrationResult {
  dryRun: boolean;
  /** เอกสารที่ต้องแปลง (ยังไม่มี is_preorder หรือยังมีฟิลด์เก่าค้าง) */
  planned: Array<{ _id: string; product_id: string | null; is_preorder: boolean; from: LegacyFields }>;
  /** เขียนสำเร็จ (0 ตอน dry-run) */
  migrated: number;
  /** ค่าเปลี่ยนระหว่างรัน — ไม่ได้เขียน */
  conflicts: string[];
  /** ตัดสินประเภทไม่ได้ — ต้องแก้มือ */
  unresolved: Array<{ _id: string; product_id: string | null; from: LegacyFields }>;
  /** prefix ของ product_id ไม่ตรงกับประเภท (หลังแปลง) */
  prefixMismatch: Array<{ _id: string; product_id: string; is_preorder: boolean }>;
  backupFile: string | null;
}

export async function runMigration(opts: { apply?: boolean; backupDir?: string } = {}): Promise<IsPreorderMigrationResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const products = db.collection("products");
  const dryRun = !opts.apply;

  const docs = await products
    .find({}, { projection: { product_id: 1, is_preorder: 1, product_types: 1, product_type: 1 } })
    .toArray();

  const planned: IsPreorderMigrationResult["planned"] = [];
  const unresolved: IsPreorderMigrationResult["unresolved"] = [];
  const prefixMismatch: IsPreorderMigrationResult["prefixMismatch"] = [];

  for (const d of docs) {
    const from: LegacyFields = {};
    if ("product_types" in d) from.product_types = d.product_types;
    if ("product_type" in d) from.product_type = d.product_type;
    const hasLegacy = "product_types" in d || "product_type" in d;
    const decided = isPreorderOf(d);

    if (decided === null) {
      unresolved.push({ _id: String(d._id), product_id: d.product_id ?? null, from });
      continue;
    }
    if (hasLegacy || typeof d.is_preorder !== "boolean") {
      planned.push({ _id: String(d._id), product_id: d.product_id ?? null, is_preorder: decided, from });
    }
    if (typeof d.product_id === "string" && d.product_id && d.product_id.split("-")[0] !== productCodePrefix(decided)) {
      prefixMismatch.push({ _id: String(d._id), product_id: d.product_id, is_preorder: decided });
    }
  }

  let migrated = 0;
  const conflicts: string[] = [];
  let backupFile: string | null = null;

  if (!dryRun && planned.length > 0) {
    const dir = opts.backupDir ?? "scripts/backups";
    mkdirSync(dir, { recursive: true });
    backupFile = `${dir}/is-preorder-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(backupFile, JSON.stringify(planned, null, 2));

    for (const p of planned) {
      // เงื่อนไข = ค่าเดิมตอนอ่าน (ฟิลด์ที่ไม่มีต้องยังไม่มี) — มีใครแก้ระหว่างรันจะไม่ match → conflict
      const guard: Record<string, unknown> = { _id: new mongoose.Types.ObjectId(p._id) };
      guard.product_types = "product_types" in p.from ? p.from.product_types : { $exists: false };
      guard.product_type = "product_type" in p.from ? p.from.product_type : { $exists: false };
      const res = await products.updateOne(guard, {
        $set: { is_preorder: p.is_preorder },
        $unset: { product_types: "", product_type: "" },
      });
      if (res.modifiedCount === 1) migrated++;
      else conflicts.push(p._id);
    }
  }

  console.log(`migrate-is-preorder ${dryRun ? "(DRY-RUN — ไม่ได้เขียนอะไร · ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"}`);
  console.log(`  สินค้าทั้งหมด: ${docs.length} · ต้องแปลง: ${planned.length} (พรีออเดอร์ ${planned.filter((p) => p.is_preorder).length})`);
  if (!dryRun) {
    console.log(`  เขียนสำเร็จ: ${migrated} · ค่าเปลี่ยนระหว่างรัน (ข้าม): ${conflicts.length}`);
    if (backupFile) console.log(`  สำรองค่าเดิม: ${backupFile}`);
  }
  console.log(`  ตัดสินประเภทไม่ได้ (ต้องแก้มือ): ${unresolved.length}`);
  for (const u of unresolved) console.log(`    - ${u._id} (${u.product_id ?? "ไม่มีรหัส"}) ${JSON.stringify(u.from)}`);
  console.log(`  prefix รหัสไม่ตรงประเภท (ไม่แก้ให้อัตโนมัติ): ${prefixMismatch.length}`);
  for (const m of prefixMismatch) console.log(`    - ${m.product_id} → ${m.is_preorder ? "พรีออเดอร์ (ควรเป็น pre-)" : "สินค้าปกติ (ควรเป็น pos-)"}`);

  return { dryRun, planned, migrated, conflicts, unresolved, prefixMismatch, backupFile };
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI (`npm run migrate:is-preorder`)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runMigration({ apply: process.argv.includes("--apply") })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
