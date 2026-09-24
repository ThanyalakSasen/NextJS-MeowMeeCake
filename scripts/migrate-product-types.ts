import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import { productTypesOf, hasPreorderType } from "../src/lib/productCode";

/**
 * docs/BACKLOG2.md §14 — ย้ายฟิลด์ `product_type` (string เดี่ยว) ของสินค้าเดิมให้เป็น `product_types`
 * (array) ครั้งเดียว ตามที่ productModel เปลี่ยน schema ไป — ต้องรันก่อน deploy โค้ดใหม่ขึ้นใช้งานจริง ไม่งั้น:
 *   - query `product_types: { $ne: "preorder" }` (STOCKABLE_MATCH / dashboard) จะนับสินค้าพรีออเดอร์เก่า
 *     ที่ยังไม่มีฟิลด์ใหม่เป็น "สินค้ามีสต็อก" ไปด้วย
 *   - `hasPreorderType()` คืน false ให้สินค้าพรีออเดอร์เก่า → ลูกค้าหยิบใส่ตะกร้าปกติได้
 *   - save() เอกสารเก่าผ่าน mongoose พัง เพราะ product_types เป็น required
 *
 * วิธีแปลง: pipeline update ครั้งเดียว `product_types = [product_type]` แล้ว `$unset product_type`
 * (ค่าเก่า "ready" แปลงเป็น "inStore" ตามที่ docs/BACKLOG.md §2d.1 เคย migrate ไปแล้ว — ใส่ไว้กันหลุด)
 * แตะเฉพาะเอกสารที่ยังไม่มี product_types เท่านั้น รันซ้ำได้ + มี marker ใน `migrations` เหมือน
 * scripts/migrate-money-to-satang.ts
 *
 * หลังแปลงจะ "รายงาน" (ไม่แก้) สินค้าที่ prefix ของ product_id ไม่ตรงกับประเภท (§14 เดิมเจอ 2 ตัว) —
 * การเปลี่ยนรหัสสินค้ามีผลกับบาร์โค้ด/ป้ายที่พิมพ์ไปแล้ว ให้แอดมินแก้ผ่าน PATCH product_types เอง
 * (updateProduct() สร้างรหัสใหม่ให้อัตโนมัติเมื่อ prefix ไม่ตรง) หรือทำสคริปต์แยก
 */
const MARKER = "product_type_to_product_types_backlog2_14";

interface MigrationDoc {
  _id: string;
  applied_at: Date;
  modified_count: number;
}

export interface ProductTypesMigrationResult {
  /** null = เคยรันแล้ว ข้าม */
  migrated: number | null;
  /** สินค้าที่ไม่มีทั้ง product_types และ product_type ที่ใช้ได้ — ต้องแก้มือ */
  unresolved: Array<{ _id: string; product_id: string | null; product_type: unknown }>;
  /** สินค้าที่ prefix ของ product_id ไม่ตรงกับ product_types */
  prefixMismatch: Array<{ _id: string; product_id: string; product_types: string[] }>;
}

/**
 * รัน migration จริง — แยกจาก CLI ให้ integration test import ไปเรียกตรง ๆ ได้ (ไม่โดน
 * mongoose.disconnect() ตอนจบ)
 */
export async function runMigration(): Promise<ProductTypesMigrationResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const products = db.collection("products");
  const marker = db.collection<MigrationDoc>("migrations");

  let migrated: number | null = null;
  if (await marker.findOne({ _id: MARKER })) {
    console.log(`  [ข้าม] "${MARKER}" เคยรันไปแล้ว`);
  } else {
    const res = await products.updateMany(
      {
        product_types: { $exists: false },
        product_type: { $in: ["inStore", "online", "preorder", "ready"] },
      },
      [
        {
          $set: {
            product_types: [
              { $cond: [{ $eq: ["$product_type", "ready"] }, "inStore", "$product_type"] },
            ],
          },
        },
        { $unset: "product_type" },
      ]
    );
    migrated = res.modifiedCount;
    await marker.insertOne({ _id: MARKER, applied_at: new Date(), modified_count: migrated });
  }

  // ตรวจหลังแปลง (read-only) — รันทุกครั้งแม้ข้าม section ด้านบน
  const docs = await products
    .find({}, { projection: { product_id: 1, product_types: 1, product_type: 1 } })
    .toArray();

  const unresolved: ProductTypesMigrationResult["unresolved"] = [];
  const prefixMismatch: ProductTypesMigrationResult["prefixMismatch"] = [];
  for (const d of docs) {
    const types = productTypesOf(d);
    if (!types) {
      unresolved.push({ _id: String(d._id), product_id: d.product_id ?? null, product_type: d.product_type });
      continue;
    }
    if (typeof d.product_id === "string" && d.product_id) {
      const expected = hasPreorderType(types) ? "pre" : "pos";
      if (d.product_id.split("-")[0] !== expected) {
        prefixMismatch.push({ _id: String(d._id), product_id: d.product_id, product_types: types });
      }
    }
  }

  console.log("migrate-product-types จบแล้ว:");
  console.log(`  แปลง product_type → product_types: ${migrated === null ? "ข้าม (เคยรันแล้ว)" : `${migrated} เอกสาร`}`);
  console.log(`  ไม่มีประเภทที่ใช้ได้ (ต้องแก้มือ): ${unresolved.length}`);
  for (const u of unresolved) console.log(`    - ${u._id} (${u.product_id ?? "ไม่มีรหัส"}) product_type=${JSON.stringify(u.product_type)}`);
  console.log(`  prefix รหัสไม่ตรงประเภท (§14, ไม่แก้ให้อัตโนมัติ): ${prefixMismatch.length}`);
  for (const m of prefixMismatch) console.log(`    - ${m.product_id} → ${m.product_types.join("/")}`);

  return { migrated, unresolved, prefixMismatch };
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI (`npm run migrate:product-types`)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runMigration()
    .catch((err) => {
      console.error("\nmigrate-product-types ล้มเหลว:", err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
