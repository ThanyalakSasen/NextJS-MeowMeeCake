import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import dbConnect from "../src/lib/dbConnect";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * sync-indexes — ปรับ index ใน MongoDB ให้ตรงกับ schema ปัจจุบัน (Model.syncIndexes())
 *   - drop index เก่าที่ไม่มีใน schema แล้ว (เช่น role_id_1_menu_key_1 เดิมของ permissions)
 *   - สร้าง index ใหม่ (เช่น unique partial ของ attendance / review / permission / product)
 *
 * ก่อน sync จะตรวจ "ข้อมูลซ้ำ" ที่จะทำให้สร้าง unique index ไม่ผ่าน:
 *   attendances : ซ้ำ (user_id + work_date) ในกลุ่มที่ deleted_at = null
 *   reviews     : ซ้ำ (order_item_id)       ในกลุ่มที่ deleted_at = null
 *
 * โหมด:
 *   (default)  ตรวจ + รายงานอย่างเดียว แล้วลอง syncIndexes (กลุ่มที่ยังซ้ำจะ fail ให้เห็น)
 *   --fix      soft-delete รายการซ้ำที่เก่ากว่า (เก็บอันที่ created_at ล่าสุด) ก่อน syncIndexes
 */

const FIX = process.argv.includes("--fix");
const MODELS_DIR = join(process.cwd(), "src", "models");

async function importAllModels(): Promise<void> {
  const files = readdirSync(MODELS_DIR).filter((f) => f.endsWith(".ts"));
  for (const f of files) {
    await import(pathToFileURL(join(MODELS_DIR, f)).href); // side-effect: register model
  }
}

/** หากลุ่มที่ซ้ำในชุด deleted_at:null — คืน [{ key, ids:[...], keepId }] */
async function findActiveDuplicates(
  model: any,
  keyFields: string[]
): Promise<Array<{ key: Record<string, any>; ids: any[]; keepId: any }>> {
  const groupId: Record<string, string> = {};
  for (const k of keyFields) groupId[k] = `$${k}`;

  const rows = await model.aggregate([
    { $match: { deleted_at: null } },
    { $sort: { created_at: 1 } },
    { $group: { _id: groupId, ids: { $push: "$_id" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);

  return rows.map((r: any) => ({
    key: r._id,
    ids: r.ids,
    keepId: r.ids[r.ids.length - 1], // created_at ล่าสุด (เรียง asc ไว้แล้ว)
  }));
}

async function handleDuplicates(
  label: string,
  model: any,
  keyFields: string[]
): Promise<number> {
  const dupes = await findActiveDuplicates(model, keyFields);
  if (dupes.length === 0) {
    console.log(`  ${label}: ไม่พบข้อมูลซ้ำ ✅`);
    return 0;
  }

  console.log(`  ${label}: พบ ${dupes.length} กลุ่มที่ซ้ำ`);
  for (const d of dupes) {
    const keyStr = JSON.stringify(d.key);
    console.log(`    - ${keyStr}  (${d.ids.length} เอกสาร) เก็บ ${d.keepId}`);
  }

  if (!FIX) {
    console.log(`  ↳ รันด้วย --fix เพื่อ soft-delete รายการซ้ำที่เก่ากว่า`);
    return dupes.length;
  }

  let removed = 0;
  for (const d of dupes) {
    const toRemove = d.ids.filter((id: any) => String(id) !== String(d.keepId));
    const res = await model.updateMany(
      { _id: { $in: toRemove }, deleted_at: null },
      { $set: { deleted_at: new Date() } }
    );
    removed += res.modifiedCount ?? 0;
  }
  console.log(`  ↳ soft-delete แล้ว ${removed} เอกสาร`);
  return 0;
}

async function main() {
  await dbConnect();
  await importAllModels();
  console.log(`โหมด: ${FIX ? "--fix (แก้ข้อมูลซ้ำ)" : "ตรวจอย่างเดียว"}\n`);

  // 1) จัดการข้อมูลซ้ำก่อน
  console.log("── ตรวจข้อมูลซ้ำ ─────────────────────────────");
  let blocking = 0;
  blocking += await handleDuplicates(
    "attendances",
    mongoose.model("Attendances"),
    ["user_id", "work_date"]
  );
  blocking += await handleDuplicates(
    "reviews",
    mongoose.model("Reviews"),
    ["order_item_id"]
  );

  if (blocking > 0 && !FIX) {
    console.log(
      `\n⚠️ ยังมีข้อมูลซ้ำ ${blocking} กลุ่ม — unique index ของ collection นั้นจะสร้างไม่ผ่าน`
    );
  }

  // 2) syncIndexes ทุก model
  console.log("\n── syncIndexes ──────────────────────────────");
  const names = mongoose.modelNames().sort();
  let okCount = 0;
  for (const name of names) {
    try {
      await mongoose.model(name).syncIndexes();
      console.log(`  ✅ ${name}`);
      okCount++;
    } catch (err: any) {
      const hint =
        err?.code === 11000 || /duplicate key/i.test(err?.message ?? "")
          ? " (มีข้อมูลซ้ำ — รันด้วย --fix ก่อน)"
          : "";
      console.log(`  ❌ ${name}: ${err?.message ?? err}${hint}`);
    }
  }
  console.log(`\nสำเร็จ ${okCount}/${names.length} model`);
}

main()
  .catch((err) => {
    console.error("\nsync-indexes ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
