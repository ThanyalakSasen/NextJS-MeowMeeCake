import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import dbConnect from "../src/lib/dbConnect";
import { generateProductCode, type ProductType } from "../src/lib/productCode";

/**
 * แก้ created_at ที่เป็น BSON Timestamp (ไม่ใช่ Date) ของสินค้า 6 รายการที่ scripts/
 * audit-bson-timestamp-fields.ts เจอ + สร้างรหัสสินค้า (product_id) ใหม่ให้ตรงกับวันที่ที่ถูกต้อง
 *
 * ⚠️ ขอบเขตรอบนี้ = เฉพาะ collection "products" (6 แถว) เท่านั้น — อีก 21 แถวใน roles/banners/
 * ingredients/ingredientcategories/units ที่ audit เจอ **ไม่ถูกแตะในสคริปต์นี้** ต้องทำแยกทีหลัง
 *
 * ที่มา: created_at ของ 6 แถวนี้เป็น BSON Timestamp (ชนิดภายในของ MongoDB สำหรับ oplog) ทำให้
 * `scripts/backfill-product-codes.ts` เดิมคำนวณ `new Date(created_at)` ได้ Invalid Date แล้วฝังคำว่า
 * "NaN" ลงในรหัสสินค้าโดยตรง (5/6 แถว) หรือได้วันที่ปลอม 1999-12-31 ที่ผ่านรูปแบบ regex แต่ไม่มีความหมาย
 * (1/6 แถว) — ผลคือสินค้า 5 รายการสแกนบาร์โค้ดที่ POS ไม่เจอเลย (isProductCode() ปฏิเสธเพราะมีตัวอักษร)
 *
 * วิธีแก้: กู้วันที่จริงจาก ObjectId ของเอกสารเอง (ฝัง Unix timestamp ตอนสร้างไว้ใน 4 byte แรกเสมอ ไม่ขึ้น
 * กับ field created_at ที่เสีย — ดูเหตุผลเต็มในหัวไฟล์ audit-bson-timestamp-fields.ts) แล้ว:
 *   1) เซ็ต created_at เป็น Date ที่กู้ได้ (ไม่แตะ updated_at — ทั้ง 6 แถวนี้ updated_at ยังปกติดีอยู่แล้ว
 *      ตาม audit และไม่ใช่ field ที่เสีย ไม่มีเหตุผลต้องเขียนทับ)
 *   2) สร้างรหัสสินค้าใหม่ด้วย generateProductCode(type, วันที่ที่กู้ได้) แทนรหัสเดิมที่อิงวันที่เสีย
 *
 * ⚠️ รหัสสินค้าเดิมจะเปลี่ยน — ถ้าเคยพิมพ์บาร์โค้ด/ป้ายราคาไปแล้วด้วยรหัสเก่า (เช่น pos-NaNNaN796)
 * ต้องพิมพ์ใหม่หลังรันสคริปต์นี้
 *
 * รัน: npx tsx scripts/audit-bson-timestamp-fields.ts   (สร้าง report ใหม่ก่อนเสมอ ถ้ายังไม่มี/เก่าเกิน 24 ชม.)
 *      npx tsx scripts/fix-bson-timestamp-products.ts     (dry-run)
 *      npx tsx scripts/fix-bson-timestamp-products.ts --apply
 *
 * ความปลอดภัย (แบบเดียวกับ fix-money-units.ts):
 *  - dry-run เป็นค่าเริ่มต้น · ปฏิเสธ report ที่เก่ากว่า 24 ชม.
 *  - ตรวจกับ DB จริงก่อนเขียนทุกแถว (ยังเป็น BSON Timestamp จริงไหม, product_id ยังตรงกับ report ไหม)
 *  - รหัสสินค้าใหม่ชนกับของเดิม (unique index) → retry ด้วยเลขสุ่มใหม่ อัตโนมัติ (แบบเดียวกับ
 *    backfill-product-codes.ts เดิม)
 *  - สำรองค่าเดิม (created_at + product_id) ลง scripts/backups/ ก่อนเขียน
 *  - marker กัน apply ซ้ำใน collection `migrations`
 */

interface ReportRow {
  collection: string;
  _id: string;
  label: string;
  bad_created_at: boolean;
  current_product_id: string | null;
}

const APPLY = process.argv.includes("--apply");
const REPORT = "scripts/audit-bson-timestamp-fields.report.json";
const MARKER = "fix_bson_timestamp_products_applied";

async function main() {
  const report = JSON.parse(readFileSync(REPORT, "utf8")) as { generated_at: string; rows: ReportRow[] };
  const ageH = (Date.now() - new Date(report.generated_at).getTime()) / 3_600_000;
  if (ageH > 24) throw new Error(`report เก่า ${ageH.toFixed(1)} ชม. — รัน audit-bson-timestamp-fields.ts ใหม่ก่อน`);

  const targets = report.rows.filter((r) => r.collection === "products");
  if (!targets.length) {
    console.log("ไม่มีแถว products ใน report — ไม่มีอะไรต้องทำ");
    return;
  }

  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db");

  if (await db.collection<{ _id: string }>("migrations").findOne({ _id: MARKER })) {
    throw new Error(`เคยรัน fix-bson-timestamp-products --apply สำเร็จแล้ว (marker ${MARKER}) — ห้ามรันซ้ำ`);
  }

  console.log(APPLY ? "โหมด APPLY — จะเขียนลงฐานข้อมูลจริง\n" : "โหมด DRY-RUN — ไม่เขียนอะไรลงฐานข้อมูล (ใส่ --apply เพื่อเขียนจริง)\n");
  console.log(`report สร้างเมื่อ ${report.generated_at} · สินค้าเป้าหมาย ${targets.length}\n`);

  interface Plan { row: ReportRow; oid: ObjectId; oldProductId: string; recoveredDate: Date; type: ProductType }
  const plans: Plan[] = [];
  const skipped: { row: ReportRow; reason: string }[] = [];

  for (const row of targets) {
    const oid = new ObjectId(row._id);
    const col = db.collection("products");
    const doc = await col.findOne({ _id: oid });
    if (!doc) { skipped.push({ row, reason: "ไม่พบสินค้าแล้ว" }); continue; }
    if (doc.created_at?.constructor?.name !== "Timestamp") {
      skipped.push({ row, reason: "created_at ไม่ใช่ BSON Timestamp แล้ว (อาจถูกแก้ไปแล้ว) — ข้าม" });
      continue;
    }
    if ((doc.product_id ?? null) !== row.current_product_id) {
      skipped.push({ row, reason: `product_id เปลี่ยนไปแล้ว (report=${row.current_product_id}, ตอนนี้=${doc.product_id})` });
      continue;
    }
    const recoveredDate = oid.getTimestamp(); // ฝังอยู่ใน ObjectId เสมอ ไม่ขึ้นกับ field ที่เสีย
    const type: ProductType =
      doc.product_type === "preorder" ? "preorder" : doc.product_type === "online" ? "online" : "inStore";
    plans.push({ row, oid, oldProductId: String(doc.product_id ?? ""), recoveredDate, type });
  }

  console.log(`จะแก้ ${plans.length} รายการ · ข้าม ${skipped.length} รายการ\n`);
  for (const p of plans) {
    console.log(`── ${p.row.label}`);
    console.log(`   created_at: BSON Timestamp (เสีย)  →  ${p.recoveredDate.toISOString()} (กู้จาก ObjectId)`);
    console.log(`   product_id: ${p.oldProductId || "(ว่าง)"}  →  รหัสใหม่ตามวันที่ที่กู้ได้ (สุ่มเลข 3 หลักท้าย — เห็นค่าจริงตอน apply)`);
  }
  for (const s of skipped) console.log(`   ข้าม ${s.row.label}: ${s.reason}`);

  if (!APPLY) {
    console.log("\nDRY-RUN จบ — ไม่มีการเขียนใด ๆ");
    return;
  }
  if (!plans.length) {
    console.log("\nไม่มีอะไรให้เขียน");
    return;
  }

  mkdirSync("scripts/backups", { recursive: true });
  const backupPath = `scripts/backups/bson-timestamp-products-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const backupData = plans.map((p) => ({ _id: p.row._id, label: p.row.label, old_product_id: p.oldProductId, old_created_at: "BSON Timestamp (ดู scripts/audit-bson-timestamp-fields.report.json สำหรับค่า t/i ดิบ)" }));
  writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
  console.log(`\nสำรองค่าเดิมแล้ว: ${backupPath}`);

  const col = db.collection("products");
  let written = 0;
  let failed = 0;
  for (const p of plans) {
    let newCode: string | null = null;
    let ok = false;
    for (let attempt = 0; attempt < 30 && !ok; attempt++) {
      newCode = generateProductCode(p.type, p.recoveredDate);
      try {
        // filter รวม created_at type เดิมไว้ด้วยทางอ้อม (เช็ค product_id ตรงเป๊ะ — ถ้าถูกแก้ไประหว่างทางจะไม่ match)
        const res = await col.updateOne(
          { _id: p.oid, product_id: p.oldProductId },
          { $set: { created_at: p.recoveredDate, product_id: newCode } }
        );
        ok = res.matchedCount === 1;
        if (!ok) break; // ค่าเปลี่ยนระหว่างทาง ไม่ใช่รหัสชนกัน — ไม่ retry
      } catch (err: unknown) {
        const code = (err as { code?: number })?.code;
        if (code === 11000 && attempt < 29) continue; // รหัสสุ่มชนกับสินค้าอื่น → สุ่มใหม่
        throw err;
      }
    }
    if (ok) {
      written++;
      console.log(`   ✅ ${p.row.label}: product_id ใหม่ = ${newCode}`);
    } else {
      failed++;
      console.log(`   ⚠️ ไม่ได้เขียน (ค่าเปลี่ยนระหว่างทาง): ${p.row.label}`);
    }
  }
  console.log(`\nเขียนสำเร็จ ${written} รายการ · ไม่สำเร็จ ${failed} รายการ`);

  if (failed === 0) {
    await db.collection<{ _id: string; applied_at: Date; modified_count: number }>("migrations").insertOne({ _id: MARKER, applied_at: new Date(), modified_count: written });
    console.log(`ลง marker ${MARKER} แล้ว — สคริปต์นี้จะไม่ยอมรันซ้ำ`);
    console.log("\n⚠️ อย่าลืม: ถ้าเคยพิมพ์บาร์โค้ด/ป้ายราคาด้วยรหัสเดิมของ 6 รายการนี้ไปแล้ว ต้องพิมพ์ใหม่");
  } else {
    console.log("มีรายการที่ไม่สำเร็จ → ไม่ลง marker; รัน audit ใหม่แล้วดูว่าที่เหลือควรทำอย่างไร");
  }
}

main()
  .catch((err) => {
    console.error("\nfix-bson-timestamp-products ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
