import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { Timestamp, ObjectId } from "mongodb";
import { writeFileSync } from "node:fs";
import dbConnect from "../src/lib/dbConnect";
import { generateProductCode, isProductCode, type ProductType } from "../src/lib/productCode";

/**
 * ตรวจหาเอกสารที่ created_at/updated_at ถูกเก็บเป็น BSON `Timestamp` (ชนิดภายในของ MongoDB สำหรับ
 * oplog/replication — ไม่ใช่ `Date`) แทนที่จะเป็น `Date` ปกติ — **อ่านอย่างเดียว ไม่เขียนอะไรลง DB**
 *
 * ที่มา: พบครั้งแรกจากรหัสสินค้า (product_id) ที่มีคำว่า "NaN" ปนอยู่ เช่น "pos-NaNNaN796" —
 * scripts/backfill-product-codes.ts ทำ `new Date(p.created_at)` แล้วได้ Invalid Date เพราะ
 * `created_at` เป็น Timestamp ไม่ใช่ Date · ตรวจ 6 collection ที่พบว่ามีปัญหาแบบเดียวกัน (สคริปต์นี้ตรวจ
 * เผื่อ collection อื่นทั้งหมดในระบบด้วย ไม่ใช่แค่ 6 ตัวที่เจอ — กันตกหล่น)
 *
 * ทำไมกู้วันที่จริงจาก created_at/updated_at ที่เสียแล้วไม่ได้: BSON Timestamp เก็บเป็น (t, i) — t คือ
 * "วินาที" นับจาก epoch ก็จริง แต่เอกสารที่เจอมี t เล็กมาก (เช่น 412, 413 = ไม่กี่นาทีหลัง 1970-01-01)
 * ซึ่งไม่ใช่เวลาที่สร้างเอกสารจริงเลย — ตัวเลขนี้ไม่มีความหมายเป็นวันที่ที่ใช้ได้
 *
 * แหล่งกู้วันที่จริงที่เชื่อถือได้กว่า: **ObjectId ของเอกสารเอง** ฝัง Unix timestamp (วินาที) ของตอนสร้าง
 * ไว้ใน 4 byte แรกเสมอ (มาจาก MongoDB/driver ตอน insert ไม่เกี่ยวกับ field created_at เลย) — ใช้
 * `objectId.getTimestamp()` ได้ตรง ๆ · เทียบกับ `updated_at` (ถ้ายังเป็น Date ปกติ) เป็นตัวเช็คสมเหตุสมผล
 *
 * รัน: npx tsx scripts/audit-bson-timestamp-fields.ts [--verbose]
 * ผลลัพธ์: สรุปตาราง + รายละเอียดใน terminal + scripts/audit-bson-timestamp-fields.report.json
 */

const VERBOSE = process.argv.includes("--verbose");

/** collection ที่รู้ตัวว่าเจอปัญหาแล้ว (label field + ประเภทสินค้าเผื่อสร้างรหัสใหม่ให้ดู) */
const KNOWN_TARGETS: { collection: string; label: string; isProduct?: boolean }[] = [
  { collection: "products", label: "product_name_th", isProduct: true },
  { collection: "roles", label: "role_name" },
  { collection: "banners", label: "banner_name" },
  { collection: "ingredients", label: "ingredient_name" },
  { collection: "ingredientcategories", label: "ingredient_category_name" },
  { collection: "units", label: "unit_name" },
];

function isBsonTimestamp(v: unknown): v is Timestamp {
  return !!v && typeof v === "object" && v.constructor?.name === "Timestamp";
}

/**
 * ค่า (t,i) ของ BSON Timestamp ตีความเป็นวันที่ตรง ๆ ไม่ได้ (ดูหมายเหตุหัวไฟล์) — ใช้แค่โชว์ให้เห็นว่า
 * ทำไมมันพัง · `.t`/`.i` เป็น getter บน prototype (ไม่ใช่ own property — Object.keys() ไม่เห็น แต่
 * เข้าถึงตรง ๆ ได้ปกติ) `.toJSON()` คืนคนละ shape จึงต้องอ่านผ่าน `.t`/`.i` เท่านั้น
 */
function describeBadTimestamp(v: Timestamp): string {
  const asDate = new Date(v as unknown as number);
  return `Timestamp(t=${v.t}, i=${v.i}) → new Date(...) = ${isNaN(asDate.getTime()) ? "Invalid Date" : asDate.toISOString() + " (ดูเหมือนใช้ได้แต่เป็นค่าไม่มีความหมาย)"}`;
}

interface Row {
  collection: string;
  _id: string;
  label: string;
  bad_created_at: boolean;
  bad_updated_at: boolean;
  created_at_detail: string | null;
  updated_at_detail: string | null;
  /** วันที่กู้จาก ObjectId ของเอกสารเอง — เชื่อถือได้เสมอ ไม่ขึ้นกับ field ที่เสีย */
  recovered_date_from_object_id: string;
  /** ถ้า updated_at ยังเป็น Date ปกติ ใกล้เคียงกับวันที่กู้จาก ObjectId ไหม (sanity check) */
  updated_at_matches_object_id: boolean | null;
  /** เฉพาะ products: รหัสปัจจุบัน / รหัสที่ควรจะเป็นถ้าใช้วันที่กู้จาก ObjectId */
  current_product_id: string | null;
  current_product_id_valid_pattern: boolean | null;
  proposed_product_id: string | null;
}

async function main() {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db");

  console.log("ตรวจหา created_at/updated_at ที่เป็น BSON Timestamp แทน Date (อ่านอย่างเดียว)\n");

  // สแกนทุก collection จริงในระบบ (ไม่ใช่แค่ 6 ตัวที่รู้ตัวแล้ว) กันตกหล่น
  const allCollections = (await db.listCollections().toArray()).map((c) => c.name);
  const targets = allCollections.map(
    (name) => KNOWN_TARGETS.find((t) => t.collection === name) ?? { collection: name, label: "_id" }
  );

  const rows: Row[] = [];
  const collectionsWithIssues = new Set<string>();

  for (const t of targets) {
    const col = db.collection(t.collection);
    const docs = await col
      .find({ $or: [{ created_at: { $type: "timestamp" } }, { updated_at: { $type: "timestamp" } }] })
      .toArray();
    if (!docs.length) continue;
    collectionsWithIssues.add(t.collection);

    for (const d of docs as Array<Record<string, unknown>>) {
      const badCreated = isBsonTimestamp(d.created_at);
      const badUpdated = isBsonTimestamp(d.updated_at);
      const oid = d._id as ObjectId;
      const recoveredDate = oid.getTimestamp(); // ฝังอยู่ใน ObjectId เสมอ ไม่ขึ้นกับ field ที่เสีย

      // แค่ข้อมูลประกอบ ไม่ใช่ตัวชี้ว่าผิดปกติ — เอกสารที่ถูกแก้ไขภายหลังสร้างนานแล้ว (ปกติมาก) ก็จะ
      // ห่างจากวันที่กู้ได้เหมือนกัน ใช้ดูแค่ว่า updated_at ไม่ได้ "มาก่อน" วันที่กู้ (ซึ่งเป็นไปไม่ได้จริง)
      let updatedMatches: boolean | null = null;
      if (!badUpdated && d.updated_at instanceof Date) {
        updatedMatches = d.updated_at.getTime() >= recoveredDate.getTime() - 60_000; // กันคลาดเคลื่อนนาฬิกาเล็กน้อย
      }

      let currentCode: string | null = null;
      let currentCodeValid: boolean | null = null;
      let proposedCode: string | null = null;
      if (t.isProduct) {
        currentCode = (d.product_id as string) ?? null;
        currentCodeValid = currentCode ? isProductCode(currentCode) : null;
        const type: ProductType =
          d.product_type === "preorder" ? "preorder" : d.product_type === "online" ? "online" : "inStore";
        proposedCode = generateProductCode(type, recoveredDate);
      }

      rows.push({
        collection: t.collection,
        _id: String(oid),
        label: String(d[t.label] ?? d._id),
        bad_created_at: badCreated,
        bad_updated_at: badUpdated,
        created_at_detail: badCreated ? describeBadTimestamp(d.created_at as Timestamp) : null,
        updated_at_detail: badUpdated ? describeBadTimestamp(d.updated_at as Timestamp) : null,
        recovered_date_from_object_id: recoveredDate.toISOString(),
        updated_at_matches_object_id: updatedMatches,
        current_product_id: currentCode,
        current_product_id_valid_pattern: currentCodeValid,
        proposed_product_id: proposedCode,
      });
    }
  }

  console.log(`collection ที่เจอปัญหา: ${collectionsWithIssues.size ? [...collectionsWithIssues].join(", ") : "(ไม่เจอเลย)"}`);
  console.log(`รวมเอกสารที่เสีย: ${rows.length}\n`);

  const byCollection = new Map<string, Row[]>();
  for (const r of rows) byCollection.set(r.collection, [...(byCollection.get(r.collection) ?? []), r]);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad("collection", 22) + pad("เสียทั้งหมด", 12) + "created_at เสีย / updated_at เสีย");
  console.log("-".repeat(70));
  for (const [c, list] of byCollection) {
    const bc = list.filter((r) => r.bad_created_at).length;
    const bu = list.filter((r) => r.bad_updated_at).length;
    console.log(pad(c, 22) + pad(String(list.length), 12) + `${bc} / ${bu}`);
  }

  console.log("\n=== รายละเอียด ===");
  for (const [c, list] of byCollection) {
    console.log(`\n--- ${c} (${list.length} เอกสาร) ---`);
    const limit = VERBOSE ? list.length : 5;
    for (const r of list.slice(0, limit)) {
      console.log(`  [${r._id}] ${r.label}`);
      if (r.created_at_detail) console.log(`    created_at: ${r.created_at_detail}`);
      if (r.updated_at_detail) console.log(`    updated_at: ${r.updated_at_detail}`);
      console.log(`    วันที่กู้จาก ObjectId: ${r.recovered_date_from_object_id}` + (r.updated_at_matches_object_id === false ? "  ⚠️ updated_at มาก่อนวันที่กู้ได้ — ผิดปกติจริง ควรดูแถวนี้เพิ่ม" : ""));
      if (r.current_product_id) {
        console.log(`    product_id ปัจจุบัน: ${r.current_product_id}  (${r.current_product_id_valid_pattern ? "รูปแบบถูกต้อง แต่มาจากวันที่เพี้ยน" : "รูปแบบผิด (สแกนที่ POS ไม่เจอ)"})  →  เสนอ: ${r.proposed_product_id}`);
      }
    }
    if (list.length > limit) console.log(`  ... อีก ${list.length - limit} รายการ (ใส่ --verbose เพื่อดูทั้งหมด)`);
  }

  const scanCode = rows.filter((r) => r.current_product_id_valid_pattern === false).length;
  console.log(`\nสินค้าที่สแกนบาร์โค้ดที่ POS ไม่เจอตอนนี้: ${scanCode} รายการ`);

  const out = "scripts/audit-bson-timestamp-fields.report.json";
  writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), collections_scanned: allCollections.length, collections_with_issues: [...collectionsWithIssues], rows }, null, 2));
  console.log(`\nรายงานเต็ม: ${out}`);
  console.log("สคริปต์นี้ไม่ได้เขียนอะไรลงฐานข้อมูล");
}

main()
  .catch((err) => {
    console.error("\naudit-bson-timestamp-fields ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
