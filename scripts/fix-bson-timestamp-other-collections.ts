import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import dbConnect from "../src/lib/dbConnect";

/**
 * แก้ created_at/updated_at ที่เป็น BSON Timestamp (ไม่ใช่ Date) ของ 21 เอกสารที่เหลือใน 5 collection
 * (roles/banners/ingredients/ingredientcategories/units) ที่ scripts/audit-bson-timestamp-fields.ts
 * เจอ — ดู docs/BACKLOG2.md §13 (ส่วน "ยังไม่ได้แก้ — เปิดค้างไว้")
 *
 * ⚠️ ขอบเขตรอบนี้ = 5 collection นี้เท่านั้น (products แก้ไปแล้วในสคริปต์คนละตัว —
 * fix-bson-timestamp-products.ts) — ไม่มี field รหัสที่พึ่งพา created_at เหมือน product_id จึงแก้แค่
 * created_at/updated_at ให้เป็น Date ปกติ ไม่ต้องสร้างรหัสใหม่แบบ products
 *
 * วิธีกู้วันที่จริง: เหมือน fix-bson-timestamp-products.ts — ใช้ ObjectId.getTimestamp() ของเอกสารเอง
 * (ฝัง Unix timestamp ตอนสร้างไว้ใน 4 byte แรกเสมอ ไม่ขึ้นกับ field created_at ที่เสีย)
 *
 * updated_at ที่เสียด้วย (4 แถว: roles 2, ingredientcategories 2) — ไม่มีแหล่งข้อมูลอื่นที่เชื่อถือได้กว่า
 * ในการกู้ "เวลาแก้ไขล่าสุดจริง" (ต่างจาก created_at ที่กู้จาก ObjectId ได้ตรง ๆ) จึงตั้งเป็นค่าเดียวกับ
 * created_at ที่กู้ได้ (สมมติว่ายังไม่เคยถูกแก้ไขหลังสร้าง — เป็นสมมติฐานที่ระมัดระวังที่สุดที่ทำได้ ไม่มี
 *ข้อมูลอื่นชี้ว่าเคยมีการแก้ไขจริงเมื่อไหร่)
 *
 * รัน: npx tsx scripts/audit-bson-timestamp-fields.ts   (สร้าง report ใหม่ก่อนเสมอ ถ้ายังไม่มี/เก่าเกิน 24 ชม.)
 *      npx tsx scripts/fix-bson-timestamp-other-collections.ts     (dry-run)
 *      npx tsx scripts/fix-bson-timestamp-other-collections.ts --apply
 *
 * ความปลอดภัย (แบบเดียวกับ fix-bson-timestamp-products.ts):
 *  - dry-run เป็นค่าเริ่มต้น · ปฏิเสธ report ที่เก่ากว่า 24 ชม.
 *  - ตรวจกับ DB จริงก่อนเขียนทุกแถว (ยังเป็น BSON Timestamp จริงไหม)
 *  - สำรองค่าเดิมลง scripts/backups/ ก่อนเขียน
 *  - marker กัน apply ซ้ำใน collection `migrations`
 */

interface ReportRow {
  collection: string;
  _id: string;
  label: string;
  bad_created_at: boolean;
  bad_updated_at: boolean;
}

const TARGET_COLLECTIONS = ["roles", "banners", "ingredients", "ingredientcategories", "units"];
const APPLY = process.argv.includes("--apply");
const REPORT = "scripts/audit-bson-timestamp-fields.report.json";
const MARKER = "fix_bson_timestamp_other_collections_applied";

async function main() {
  const report = JSON.parse(readFileSync(REPORT, "utf8")) as { generated_at: string; rows: ReportRow[] };
  const ageH = (Date.now() - new Date(report.generated_at).getTime()) / 3_600_000;
  if (ageH > 24) throw new Error(`report เก่า ${ageH.toFixed(1)} ชม. — รัน audit-bson-timestamp-fields.ts ใหม่ก่อน`);

  const targets = report.rows.filter((r) => TARGET_COLLECTIONS.includes(r.collection));
  if (!targets.length) {
    console.log("ไม่มีแถวใน 5 collection เป้าหมายใน report — ไม่มีอะไรต้องทำ");
    return;
  }

  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db");

  if (await db.collection<{ _id: string }>("migrations").findOne({ _id: MARKER })) {
    throw new Error(`เคยรัน fix-bson-timestamp-other-collections --apply สำเร็จแล้ว (marker ${MARKER}) — ห้ามรันซ้ำ`);
  }

  console.log(APPLY ? "โหมด APPLY — จะเขียนลงฐานข้อมูลจริง\n" : "โหมด DRY-RUN — ไม่เขียนอะไรลงฐานข้อมูล (ใส่ --apply เพื่อเขียนจริง)\n");
  console.log(`report สร้างเมื่อ ${report.generated_at} · เอกสารเป้าหมาย ${targets.length} (${TARGET_COLLECTIONS.join("/")})\n`);

  interface Plan {
    row: ReportRow;
    oid: ObjectId;
    recoveredDate: Date;
    fixCreated: boolean;
    fixUpdated: boolean;
  }
  const plans: Plan[] = [];
  const skipped: { row: ReportRow; reason: string }[] = [];

  for (const row of targets) {
    const oid = new ObjectId(row._id);
    const col = db.collection(row.collection);
    const doc = await col.findOne({ _id: oid });
    if (!doc) {
      skipped.push({ row, reason: "ไม่พบเอกสารแล้ว" });
      continue;
    }
    const stillBadCreated = doc.created_at?.constructor?.name === "Timestamp";
    const stillBadUpdated = doc.updated_at?.constructor?.name === "Timestamp";
    if (row.bad_created_at && !stillBadCreated) {
      skipped.push({ row, reason: "created_at ไม่ใช่ BSON Timestamp แล้ว (อาจถูกแก้ไปแล้ว) — ข้าม" });
      continue;
    }
    if (row.bad_updated_at && !stillBadUpdated) {
      skipped.push({ row, reason: "updated_at ไม่ใช่ BSON Timestamp แล้ว (อาจถูกแก้ไปแล้ว) — ข้าม" });
      continue;
    }
    const recoveredDate = oid.getTimestamp(); // ฝังอยู่ใน ObjectId เสมอ ไม่ขึ้นกับ field ที่เสีย
    plans.push({
      row,
      oid,
      recoveredDate,
      fixCreated: row.bad_created_at && stillBadCreated,
      fixUpdated: row.bad_updated_at && stillBadUpdated,
    });
  }

  console.log(`จะแก้ ${plans.length} รายการ · ข้าม ${skipped.length} รายการ\n`);
  for (const p of plans) {
    const fields = [p.fixCreated && "created_at", p.fixUpdated && "updated_at"].filter(Boolean).join(" + ");
    console.log(`── [${p.row.collection}] ${p.row.label}`);
    console.log(`   ${fields}: BSON Timestamp (เสีย)  →  ${p.recoveredDate.toISOString()} (กู้จาก ObjectId)`);
  }
  for (const s of skipped) console.log(`   ข้าม [${s.row.collection}] ${s.row.label}: ${s.reason}`);

  if (!APPLY) {
    console.log("\nDRY-RUN จบ — ไม่มีการเขียนใด ๆ");
    return;
  }
  if (!plans.length) {
    console.log("\nไม่มีอะไรให้เขียน");
    return;
  }

  mkdirSync("scripts/backups", { recursive: true });
  const backupPath = `scripts/backups/bson-timestamp-other-collections-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const backupData = plans.map((p) => ({
    collection: p.row.collection,
    _id: p.row._id,
    label: p.row.label,
    fixed_created_at: p.fixCreated,
    fixed_updated_at: p.fixUpdated,
    note: "ค่าเดิมเป็น BSON Timestamp (ดู scripts/audit-bson-timestamp-fields.report.json สำหรับ t/i ดิบ)",
  }));
  writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
  console.log(`\nสำรองรายการที่แก้แล้ว: ${backupPath}`);

  let written = 0;
  let failed = 0;
  for (const p of plans) {
    const col = db.collection(p.row.collection);
    const set: Record<string, Date> = {};
    if (p.fixCreated) set.created_at = p.recoveredDate;
    if (p.fixUpdated) set.updated_at = p.recoveredDate;

    const filter: Record<string, unknown> = { _id: p.oid };
    // filter รวม type เดิมไว้ด้วย กันเขียนทับถ้ามีคนแก้ไปแล้วระหว่างทาง (คล้าย fix-bson-timestamp-products.ts)
    if (p.fixCreated) filter.created_at = { $type: "timestamp" };
    if (p.fixUpdated) filter.updated_at = { $type: "timestamp" };

    const res = await col.updateOne(filter, { $set: set });
    if (res.matchedCount === 1) {
      written++;
      console.log(`   ✅ [${p.row.collection}] ${p.row.label}`);
    } else {
      failed++;
      console.log(`   ⚠️ ไม่ได้เขียน (ค่าเปลี่ยนระหว่างทาง): [${p.row.collection}] ${p.row.label}`);
    }
  }
  console.log(`\nเขียนสำเร็จ ${written} รายการ · ไม่สำเร็จ ${failed} รายการ`);

  if (failed === 0) {
    await db.collection<{ _id: string; applied_at: Date; modified_count: number }>("migrations").insertOne({
      _id: MARKER,
      applied_at: new Date(),
      modified_count: written,
    });
    console.log(`ลง marker ${MARKER} แล้ว — สคริปต์นี้จะไม่ยอมรันซ้ำ`);
  } else {
    console.log("มีรายการที่ไม่สำเร็จ → ไม่ลง marker; รัน audit ใหม่แล้วดูว่าที่เหลือควรทำอย่างไร");
  }
}

main()
  .catch((err) => {
    console.error("\nfix-bson-timestamp-other-collections ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
