import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import aspectModel, { ASPECT_NAME_INDEX } from "../src/models/aspectModel";

/**
 * docs/BACKLOG5.md G5 — ตรวจชื่อแง่มุมรีวิวซ้ำ ก่อนสร้าง unique index ชื่อ (`uniq_active_aspect_name_th`)
 *
 * อ่านอย่างเดียวเป็นค่าเริ่มต้น — รายงาน:
 *   - กลุ่มชื่อซ้ำ (แง่มุมที่ยังไม่ถูกลบ · เทียบแบบตัดช่องว่างหัวท้าย + ไม่สนตัวพิมพ์) พร้อมจำนวนที่ถูกอ้างถึง
 *     (รีวิว aspect_feedback · คำวิเคราะห์ SemanticTerms · ผลวิเคราะห์ SentimentResults) ช่วยเลือกว่าจะเก็บตัวไหน
 *   - ชื่อที่มีช่องว่างหัว/ท้าย (index เทียบตามตัวอักษรจริง — " ราคา" กับ "ราคา" ไม่ถือว่าซ้ำ)
 *   - มี index แล้วหรือยัง
 * `--apply` = สร้าง index **เฉพาะเมื่อไม่มีชื่อซ้ำ** (มีซ้ำ = ไม่สร้าง · ให้แก้ชื่อหรือลบแบบ soft delete ในหลังร้านก่อน แล้วรันใหม่)
 * ไม่แก้/ลบข้อมูลใด ๆ · ไม่แตะ index อื่นของ backend ฝั่งลูกค้า · รันซ้ำได้
 *
 * รัน: npm run check:aspect-names              (ตรวจอย่างเดียว)
 *      npm run check:aspect-names -- --apply   (สร้าง index ถ้าไม่มีชื่อซ้ำ)
 */

type AspectRow = { _id: string; aspect_name_th: string; is_active: boolean; created_at: Date | null; reviews: number; terms: number; results: number };

export interface AspectNameCheckResult {
  dryRun: boolean;
  total: number;
  duplicates: AspectRow[][];
  untrimmed: Array<{ _id: string; aspect_name_th: string }>;
  indexExisted: boolean;
  indexCreated: boolean;
}

const normalize = (name: string) => name.trim().toLowerCase();

export async function runAspectNameCheck(opts: { apply?: boolean } = {}): Promise<AspectNameCheckResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const dryRun = !opts.apply;

  const aspects = await aspectModel
    .find({ deleted_at: null })
    .select("aspect_name_th is_active created_at")
    .lean<Array<{ _id: unknown; aspect_name_th?: string; is_active?: boolean; created_at?: Date }>>();

  const groups = new Map<string, typeof aspects>();
  for (const a of aspects) {
    const key = normalize(String(a.aspect_name_th ?? ""));
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);

  // จำนวนที่ถูกอ้างถึง — เฉพาะแง่มุมในกลุ่มที่ซ้ำ
  const dupIds = dupGroups.flat().map((a) => a._id);
  const countBy = async (collection: string, field: string) => {
    if (dupIds.length === 0) return new Map<string, number>();
    const rows = await db
      .collection(collection)
      .aggregate<{ _id: unknown; n: number }>([
        { $match: { [field]: { $in: dupIds } } },
        ...(field.includes(".") ? [{ $unwind: `$${field.split(".")[0]}` }, { $match: { [field]: { $in: dupIds } } }] : []),
        { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((r) => [String(r._id), r.n]));
  };
  const [reviews, terms, results] = await Promise.all([
    countBy("reviews", "aspect_feedback.aspect_id"),
    countBy("semanticterms", "aspect_id"),
    countBy("sentimentresults", "aspect_id"),
  ]);
  const duplicates: AspectRow[][] = dupGroups.map((g) =>
    g
      .map((a) => ({
        _id: String(a._id),
        aspect_name_th: String(a.aspect_name_th ?? ""),
        is_active: a.is_active !== false,
        created_at: a.created_at ?? null,
        reviews: reviews.get(String(a._id)) ?? 0,
        terms: terms.get(String(a._id)) ?? 0,
        results: results.get(String(a._id)) ?? 0,
      }))
      .sort((x, y) => (x.created_at?.getTime() ?? 0) - (y.created_at?.getTime() ?? 0))
  );
  const untrimmed = aspects
    .filter((a) => String(a.aspect_name_th ?? "") !== String(a.aspect_name_th ?? "").trim())
    .map((a) => ({ _id: String(a._id), aspect_name_th: String(a.aspect_name_th ?? "") }));

  const indexes = await aspectModel.collection.indexes().catch(() => [] as Array<{ name?: string }>);
  const indexExisted = indexes.some((ix) => ix.name === ASPECT_NAME_INDEX.name);

  let indexCreated = false;
  if (!dryRun && !indexExisted && duplicates.length === 0) {
    await aspectModel.collection.createIndex({ aspect_name_th: 1 }, { ...ASPECT_NAME_INDEX });
    indexCreated = true;
  }

  console.log(`check-aspect-names ${dryRun ? "(ตรวจอย่างเดียว — ใส่ --apply เพื่อสร้าง index)" : "(APPLY)"}`);
  console.log(`  แง่มุมที่ยังไม่ถูกลบ: ${aspects.length}`);
  if (duplicates.length === 0) console.log("  ชื่อซ้ำ: ไม่มี ✅");
  else {
    console.log(`  ⚠️ ชื่อซ้ำ ${duplicates.length} กลุ่ม — แก้ชื่อหรือลบ (soft delete) ในหลังร้านให้เหลือกลุ่มละ 1 แล้วรันใหม่:`);
    for (const g of duplicates) {
      console.log(`    "${g[0].aspect_name_th.trim()}"`);
      for (const a of g) {
        console.log(
          `      - ${a._id} "${a.aspect_name_th}" ${a.is_active ? "เปิด" : "ปิด"} · สร้าง ${a.created_at?.toISOString() ?? "-"} · รีวิว ${a.reviews} · คำวิเคราะห์ ${a.terms} · ผลวิเคราะห์ ${a.results}`
        );
      }
    }
  }
  if (untrimmed.length) {
    console.log(`  ชื่อมีช่องว่างหัว/ท้าย (index ไม่นับว่าซ้ำกับชื่อที่ไม่มีช่องว่าง — ควรแก้): ${untrimmed.map((u) => `${u._id} "${u.aspect_name_th}"`).join(", ")}`);
  }
  console.log(`  index ${ASPECT_NAME_INDEX.name}: ${indexExisted ? "มีแล้ว" : indexCreated ? "สร้างแล้ว ✅" : duplicates.length ? "ยังไม่สร้าง (มีชื่อซ้ำ)" : "ยังไม่มี"}`);

  return { dryRun, total: aspects.length, duplicates, untrimmed, indexExisted, indexCreated };
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runAspectNameCheck({ apply: process.argv.includes("--apply") })
    .then((r) => {
      if (r.duplicates.length > 0) process.exitCode = 2; // มีชื่อซ้ำ — ให้ CI/คนรันเห็นชัด
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
