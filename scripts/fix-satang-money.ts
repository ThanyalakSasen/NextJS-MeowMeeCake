import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import { round2 } from "../src/lib/money";

/**
 * docs/money-units.md §3 — แก้ค่าเงินที่ยังเป็น "สตางค์" ใน DB จริง (เหลือจากยุค BACKLOG §3.11) ให้เป็นบาท (÷100)
 *
 * ที่มา: 2026-09-12 สคริปต์ย้ายเป็นสตางค์คูณ 100 ข้อมูลทั้งหมดที่มีตอนนั้น + backend ในเครื่อง dev เขียนสตางค์ต่อถึงราว 2026-09-17 ·
 * หลังจากนั้นทุกฝั่งเขียนบาท (FrontOffice · backend ฝั่งลูกค้า · backend นี้หลัง #57) → ใน DB มีสองหน่วยปนกัน
 *
 * ตัดสินหน่วยทีละค่า (ไม่เดาจากขนาดตัวเลขอย่างเดียว):
 *   เทียบค่าอ้างอิง  products.sale_price          > product_price และ ÷100 แล้ว < product_price
 *                   preorderrounditems.price_override / cartitems.price_snapshot  ≥ 10 × product_price ของสินค้า
 *                   (1.6–10 เท่า = ตัดสินไม่ได้ → รายงาน ไม่แตะ)
 *   ดูวันที่บันทึก   (ไม่มีค่าอ้างอิง) เขียนก่อน SATANG_CUTOFF:
 *                   payments.amount · preorders + preorderitems (ยอดไม่เปลี่ยนหลังสร้าง → created_at)
 *                   promotions (เงิน — ไม่รวม % และแต้ม) · expenses · ingredients · components · recipes (แก้ได้ → updated_at)
 *                   payments ที่ ÷100 แล้วต่ำกว่า 10 บาท = ตัดสินไม่ได้ (น่าจะทดสอบจ่าย 1 บาท) → รายงาน ไม่แตะ
 *
 * ความปลอดภัย:
 *   - dry-run ค่าเริ่มต้น · --apply สำรองแผนลง scripts/backups/satang-money-*.json ก่อน
 *   - บันทึกทุกค่าที่แก้ใน collection `money_unit_fixes` (unique ต่อ collection+เอกสาร+ฟิลด์) ก่อนเขียน → รันซ้ำไม่หาร 100 ซ้ำ
 *     (ค่าที่ใช้วันที่ตัดสินจะเข้าเงื่อนไขเดิมทุกครั้ง — กันด้วยบันทึกนี้)
 *   - เขียนแบบมีเงื่อนไข { _id, field: ค่าเดิม } · ไม่แตะ updated_at · ค่าที่ถูกแก้ระหว่างรัน = ข้าม (conflict)
 *
 * รัน: npm run fix:satang-money              (dry-run)
 *      npm run fix:satang-money -- --apply   (เขียนจริง)
 */

/** ข้อมูลที่เขียนก่อนเวลานี้ = สตางค์ (สตางค์ล่าสุดใน DB จริง 2026-09-17 · บาทแรกหลังจากนั้น 2026-09-24) */
export const SATANG_CUTOFF = new Date("2026-09-20T00:00:00Z");
/** ตัวคูณขั้นต่ำเทียบราคาสินค้าที่ถือว่าเป็นสตางค์แน่ ๆ (ราคาเปลี่ยนตามเวลาได้ แต่ไม่ถึง 10 เท่า) */
const RATIO_SATANG = 10;
/** ต่ำกว่านี้ = ใกล้ราคาสินค้า ถือเป็นบาท · ระหว่างนี้กับ RATIO_SATANG = ตัดสินไม่ได้ */
const RATIO_BAHT = 1.6;
const MIN_PAYMENT_BAHT = 10;
export const FIX_LOG = "money_unit_fixes";

export interface MoneyFix {
  collection: string;
  _id: string;
  field: string;
  label: string;
  old: number;
  new: number;
}
export interface MoneyReview {
  collection: string;
  _id: string;
  field: string;
  label: string;
  value: number;
  reason: string;
}
export interface SatangFixResult {
  dryRun: boolean;
  planned: MoneyFix[];
  review: MoneyReview[];
  /** ค่าที่เคยแก้ไปแล้ว (มีในบันทึก) — ข้าม */
  alreadyFixed: number;
  updated: number;
  conflicts: MoneyFix[];
  backupFile: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- เอกสารดิบจากหลาย collection (อ่านตรงจาก driver)
type Doc = Record<string, any>;
const isMoney = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v !== 0;
const before = (d: unknown) => d instanceof Date && d.getTime() < SATANG_CUTOFF.getTime();
const lastWritten = (doc: Doc) => doc.updated_at ?? doc.created_at;

export async function runSatangFix(opts: { apply?: boolean; backupDir?: string } = {}): Promise<SatangFixResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const dryRun = !opts.apply;
  const col = (name: string) => db.collection(name);

  // ค่าที่เคยแก้ไปแล้ว (กันหาร 100 ซ้ำ) — เช็กก่อนตัดสินทุกกฎ: ค่าที่ใช้วันที่ตัดสินจะเข้าเงื่อนไขเดิมทุกครั้ง
  const log = col(FIX_LOG);
  const key = (c: string, id: string, f: string) => `${c}|${id}|${f}`;
  const done = await log.find({}).project({ collection: 1, doc_id: 1, field: 1 }).toArray();
  const doneKeys = new Set(done.map((d) => key(d.collection, String(d.doc_id), d.field)));
  let alreadyFixed = 0;
  const isDone = (collection: string, doc: Doc, field: string) => {
    if (!doneKeys.has(key(collection, String(doc._id), field))) return false;
    alreadyFixed++;
    return true;
  };

  const planned: MoneyFix[] = [];
  const review: MoneyReview[] = [];
  const fix = (collection: string, doc: Doc, field: string, label: string) => {
    if (isDone(collection, doc, field)) return;
    planned.push({ collection, _id: String(doc._id), field, label, old: doc[field], new: round2(doc[field] / 100) });
  };
  const flag = (collection: string, doc: Doc, field: string, label: string, reason: string) => {
    if (isDone(collection, doc, field)) return;
    review.push({ collection, _id: String(doc._id), field, label, value: doc[field], reason });
  };

  const products = await col("products").find({}).project({ product_id: 1, product_name_th: 1, product_price: 1, sale_price: 1 }).toArray();
  const productById = new Map(products.map((p) => [String(p._id), p]));

  // ── เทียบค่าอ้างอิง ─────────────────────────────────────────
  for (const p of products) {
    if (isMoney(p.sale_price) && isMoney(p.product_price) && p.sale_price > p.product_price && p.sale_price / 100 < p.product_price) {
      fix("products", p, "sale_price", `${p.product_id} ${p.product_name_th ?? ""}`.trim());
    }
  }
  const byProductRatio = (collection: string, field: string) => async () => {
    const docs = await col(collection).find({ [field]: { $type: "number", $ne: 0 } }).project({ product_id: 1, [field]: 1 }).toArray();
    for (const d of docs) {
      const p = productById.get(String(d.product_id));
      const label = p ? `${p.product_id} (ราคา ${p.product_price})` : `สินค้า ${d.product_id}`;
      if (!p || !isMoney(p.product_price)) {
        flag(collection, d, field, label, "หาสินค้า/ราคาสินค้าไม่เจอ");
        continue;
      }
      const ratio = d[field] / p.product_price;
      if (ratio >= RATIO_SATANG) fix(collection, d, field, label);
      else if (ratio > RATIO_BAHT) flag(collection, d, field, label, `${ratio.toFixed(1)} เท่าของราคาสินค้า — ตัดสินหน่วยไม่ได้`);
    }
  };
  await byProductRatio("preorderrounditems", "price_override")();
  await byProductRatio("cartitems", "price_snapshot")();

  // ── ดูวันที่บันทึก ──────────────────────────────────────────
  const payments = await col("payments").find({ created_at: { $lt: SATANG_CUTOFF } }).project({ amount: 1, created_at: 1 }).toArray();
  for (const p of payments) {
    if (!isMoney(p.amount)) continue;
    const label = `ชำระเงิน ${(p.created_at as Date).toISOString().slice(0, 10)}`;
    if (p.amount / 100 < MIN_PAYMENT_BAHT) flag("payments", p, "amount", label, `÷100 แล้วเหลือ ${p.amount / 100} บาท — ตัดสินหน่วยไม่ได้`);
    else fix("payments", p, "amount", label);
  }

  const PREORDER_FIELDS = ["subtotal", "discount_amount", "delivery_fee", "total_amount", "points_discount", "coupon_discount"];
  const ITEM_FIELDS = ["unit_price", "total_price", "cost_per_unit", "variant_price"];
  const preorders = await col("preorders").find({ created_at: { $lt: SATANG_CUTOFF } }).toArray();
  for (const o of preorders) {
    for (const f of PREORDER_FIELDS) if (isMoney(o[f])) fix("preorders", o, f, o.preorder_no);
  }
  const items = preorders.length
    ? await col("preorderitems").find({ preorder_id: { $in: preorders.map((o) => o._id) } }).toArray()
    : [];
  const preorderNo = new Map(preorders.map((o) => [String(o._id), o.preorder_no as string]));
  for (const it of items) {
    const label = `รายการของ ${preorderNo.get(String(it.preorder_id))}`;
    for (const f of ITEM_FIELDS) if (isMoney(it[f])) fix("preorderitems", it, f, label);
    if ((it.selected_options ?? []).some((o: Doc) => isMoney(o?.extra_price))) {
      review.push({ collection: "preorderitems", _id: String(it._id), field: "selected_options.extra_price", label, value: NaN, reason: "ตัวเลือกเสริมในรายการ — แก้เอง" });
    }
  }

  const byDate = async (collection: string, fields: (doc: Doc) => string[], label: (doc: Doc) => string) => {
    const docs = await col(collection).find({}).toArray();
    for (const d of docs) {
      if (!before(lastWritten(d))) continue;
      for (const f of fields(d)) if (isMoney(d[f])) fix(collection, d, f, label(d));
    }
  };
  await byDate(
    "promotions",
    // ส่วนลดแบบ % ไม่ใช่เงิน · points_cost เป็นแต้ม
    (d) => ["min_order_amount", "max_discount_amount", ...(d.discount_type === "Amount" ? ["discount_value"] : [])],
    (d) => d.promotion_name
  );
  await byDate("expenses", () => ["amount"], (d) => `ค่าใช้จ่าย ${d.description ?? d._id}`);
  await byDate("ingredients", () => ["cost_per_unit"], (d) => d.ingredient_name);
  await byDate("components", () => ["estimated_cost_per_batch"], (d) => d.component_name);
  await byDate("recipes", () => ["estimated_cost_per_batch"], (d) => d.recipe_name);

  const todo = planned;
  let updated = 0;
  const conflicts: MoneyFix[] = [];
  let backupFile: string | null = null;
  if (!dryRun && todo.length) {
    const dir = opts.backupDir ?? "scripts/backups";
    mkdirSync(dir, { recursive: true });
    backupFile = `${dir}/satang-money-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(backupFile, JSON.stringify(todo, null, 2));

    await log.createIndex({ collection: 1, doc_id: 1, field: 1 }, { unique: true });
    for (const p of todo) {
      const docId = new mongoose.Types.ObjectId(p._id);
      // จองในบันทึกก่อนเขียน — ถ้าล้มกลางทาง รอบหน้าจะไม่หารซ้ำ (ดูค่าจริงเทียบ old/new ในบันทึกได้)
      try {
        await log.insertOne({ collection: p.collection, doc_id: docId, field: p.field, old: p.old, new: p.new, fixed_at: new Date() });
      } catch (err) {
        if ((err as { code?: number })?.code === 11000) continue;
        throw err;
      }
      const res = await col(p.collection).updateOne({ _id: docId, [p.field]: p.old }, { $set: { [p.field]: p.new } });
      if (res.modifiedCount === 1) updated++;
      else {
        conflicts.push(p);
        await log.deleteOne({ collection: p.collection, doc_id: docId, field: p.field });
      }
    }
  }

  const counts = new Map<string, number>();
  for (const p of todo) counts.set(p.collection, (counts.get(p.collection) ?? 0) + 1);
  console.log(`fix-satang-money ${dryRun ? "(DRY-RUN — ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"} · ตัดวันที่ ${SATANG_CUTOFF.toISOString()}`);
  console.log(`  ค่าที่เป็นสตางค์ → ÷100: ${todo.length}${alreadyFixed ? ` · เคยแก้แล้ว (ข้าม): ${alreadyFixed}` : ""}`);
  for (const [c, n] of counts) {
    console.log(`  ${c}: ${n}`);
    for (const p of todo.filter((x) => x.collection === c)) console.log(`    - ${p.label} · ${p.field}: ${p.old} → ${p.new}`);
  }
  if (review.length) {
    console.log(`  ตัดสินไม่ได้ (ไม่แตะ — ตรวจเอง): ${review.length}`);
    for (const r of review) console.log(`    - ${r.collection} ${r._id} ${r.label} · ${r.field}: ${r.value} — ${r.reason}`);
  }
  if (!dryRun) {
    console.log(`  เขียนสำเร็จ: ${updated} · ค่าเปลี่ยนระหว่างรัน (ข้าม): ${conflicts.length}`);
    if (backupFile) console.log(`  แผนที่แก้: ${backupFile}`);
  }

  return { dryRun, planned: todo, review, alreadyFixed, updated, conflicts, backupFile };
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI (`npm run fix:satang-money`)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runSatangFix({ apply: process.argv.includes("--apply") })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
