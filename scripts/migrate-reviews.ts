import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import reviewModel from "../src/models/reviewModel";

/**
 * docs/customer-backend-merge.md §8.20 — เตรียม collection `reviews` ให้รองรับรีวิวพรีออเดอร์ + สถานะแบบเดียวกันทั้งสองระบบ
 *
 *   1. เติม `status` ให้รีวิวที่ backend หลักเขียนไว้ก่อนหน้านี้ (ไม่มี status): is_visible false → hidden · อื่น ๆ → approved
 *      (backend ฝั่งลูกค้าแสดงเฉพาะ status approved — ไม่เติม = รีวิวจากหลักไม่โผล่ที่หน้าเว็บฝั่งลูกค้า)
 *   2. index: ลบ `order_item_id_1` **เฉพาะเมื่อเป็น unique** (ของหลักเดิม — นับ order_item_id: null ของรีวิวพรีออเดอร์ซ้ำกัน
 *      → รีวิวพรีออเดอร์ชิ้นที่ 2 บันทึกไม่ได้) แล้วสร้าง index ใหม่ตาม schema (uniq_active_order_item / uniq_active_preorder_item)
 *      ถ้ามีรีวิวซ้ำรายการเดียวกันอยู่แล้ว → ไม่สร้าง unique index นั้น รายงานให้ตรวจเอง
 *   3. รายงาน (ไม่แก้) รีวิวที่ status กับ is_visible ขัดกัน
 *
 * ความปลอดภัย: dry-run ค่าเริ่มต้น · --apply backup รายการที่เติม status ไว้ที่ scripts/backups/reviews-status-*.json ก่อน ·
 * เขียนแบบมีเงื่อนไข (ยังไม่มี status) · ไม่แตะ updated_at · รันซ้ำได้
 *
 * รัน: npm run migrate:reviews              (dry-run)
 *      npm run migrate:reviews -- --apply   (เขียนจริง)
 */

export interface ReviewMigrationResult {
  dryRun: boolean;
  missingStatus: { approved: number; hidden: number };
  statusFilled: number;
  mismatched: number;
  droppedIndexes: string[];
  createdIndexes: boolean;
  duplicates: { order_item_id: number; preorder_order_item_id: number };
  backupFile: string | null;
}

async function countDuplicates(field: "order_item_id" | "preorder_order_item_id"): Promise<number> {
  const rows = await reviewModel.aggregate([
    { $match: { deleted_at: null, [field]: { $type: "objectId" } } },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: "dups" },
  ]);
  return rows[0]?.dups ?? 0;
}

export async function runReviewMigration(opts: { apply?: boolean; backupDir?: string } = {}): Promise<ReviewMigrationResult> {
  await dbConnect();
  const reviews = reviewModel.collection;
  const dryRun = !opts.apply;

  // 1. status ที่ขาด
  const missing = await reviews
    .find({ status: { $exists: false } })
    .project({ is_visible: 1 })
    .toArray();
  const toHidden = missing.filter((d) => d.is_visible === false).map((d) => d._id);
  const toApproved = missing.filter((d) => d.is_visible !== false).map((d) => d._id);

  // 3. ขัดกัน (รายงานเท่านั้น)
  const mismatched = await reviews.countDocuments({
    $or: [{ status: "approved", is_visible: false }, { status: { $in: ["hidden", "pending"] }, is_visible: true }],
  });

  // 2. index
  const indexes = await reviews.indexes();
  const blocking = indexes.filter((ix) => ix.name === "order_item_id_1" && ix.unique);
  const duplicates = {
    order_item_id: await countDuplicates("order_item_id"),
    preorder_order_item_id: await countDuplicates("preorder_order_item_id"),
  };

  let statusFilled = 0;
  const droppedIndexes: string[] = [];
  let createdIndexes = false;
  let backupFile: string | null = null;
  if (!dryRun) {
    if (missing.length) {
      const dir = opts.backupDir ?? "scripts/backups";
      mkdirSync(dir, { recursive: true });
      backupFile = `${dir}/reviews-status-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      writeFileSync(backupFile, JSON.stringify({ approved: toApproved.map(String), hidden: toHidden.map(String) }, null, 2));
      for (const [ids, status] of [[toApproved, "approved"], [toHidden, "hidden"]] as const) {
        if (!ids.length) continue;
        const res = await reviews.updateMany({ _id: { $in: ids }, status: { $exists: false } }, { $set: { status } });
        statusFilled += res.modifiedCount;
      }
    }
    for (const ix of blocking) {
      await reviews.dropIndex(ix.name!);
      droppedIndexes.push(ix.name!);
    }
    if (duplicates.order_item_id === 0 && duplicates.preorder_order_item_id === 0) {
      await reviewModel.createIndexes(); // สร้างเฉพาะที่ยังไม่มี — ไม่ลบ index อื่นของ backend ฝั่งลูกค้า
      createdIndexes = true;
    }
  }

  console.log(`migrate-reviews ${dryRun ? "(DRY-RUN — ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"}`);
  console.log(`  ไม่มี status: ${missing.length} รายการ → approved ${toApproved.length} · hidden ${toHidden.length}`);
  console.log(`  status/is_visible ขัดกัน (ไม่แก้ — ตรวจเอง): ${mismatched}`);
  console.log(`  index unique เดิมที่บล็อกรีวิวพรีออเดอร์: ${blocking.length ? blocking.map((i) => i.name).join(", ") : "ไม่มี"}`);
  if (duplicates.order_item_id || duplicates.preorder_order_item_id) {
    console.log(
      `  ⚠️ มีรีวิวซ้ำรายการเดียวกัน — order_item ${duplicates.order_item_id} · preorder_item ${duplicates.preorder_order_item_id} ` +
        `(ยังไม่สร้าง unique index — ลบรีวิวซ้ำแบบ soft delete ก่อนแล้วรันใหม่)`
    );
  }
  if (!dryRun) {
    console.log(
      `  เติม status: ${statusFilled}${backupFile ? ` · backup: ${backupFile}` : ""} · ลบ index: ${droppedIndexes.join(", ") || "-"} · ` +
        `สร้าง index ตาม schema: ${createdIndexes ? "แล้ว" : "ข้าม"}`
    );
  }

  return {
    dryRun,
    missingStatus: { approved: toApproved.length, hidden: toHidden.length },
    statusFilled,
    mismatched,
    droppedIndexes,
    createdIndexes,
    duplicates,
    backupFile,
  };
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runReviewMigration({ apply: process.argv.includes("--apply") })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
