import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import { round2 } from "../src/lib/money";

/**
 * docs/money-units.md — ย้ายเงินใน DB จาก "สตางค์" (BACKLOG §3.11) กลับเป็น "บาท" (÷100) ครั้งเดียว
 *
 * ทำไม: FrontOffice อ่าน/เขียน MongoDB ตรงเป็นบาท → DB มีสองหน่วยปนกัน (BACKLOG2 §16, BACKLOG4 R7)
 * ตัดสินใจ 2026-10-01: ทั้งระบบเก็บเป็นบาท (โค้ดใน PR เดียวกันเปลี่ยนแล้ว)
 *
 * ข้อมูลจริงมีทั้งสองหน่วยปน (ตรวจ 2026-10-01) จึงแบ่งฟิลด์เป็น 2 แบบ:
 *   all       ÷100 ทุกค่า — ฟิลด์ที่ FrontOffice ไม่เขียน/ตรวจแล้วเป็นสตางค์ทั้งหมด (ต้นทุน, วัตถุดิบ, สูตร,
 *             ค่าใช้จ่าย, โปรโมชัน, พรีออเดอร์, sale_price ฯลฯ)
 *   big-only  ÷100 เฉพาะค่า ≥ 1,000 — ค่า < 1,000 ถือว่าเป็นบาทอยู่แล้ว (FrontOffice/ช่วงราคาเพี้ยน) ไม่แตะ:
 *             product_price (บาททั้ง 42 ตัว) · ยอดออเดอร์/รายการ/ค่าส่ง · การชำระเงิน · ตะกร้า · price_override
 *             (สินค้าร้านนี้ไม่มีชิ้นไหนต่ำกว่า 10 บาท → สตางค์ ≥ 1,000 เสมอ)
 * หลังคำนวณ: ออเดอร์/พรีออเดอร์ที่ subtotal − discount + delivery_fee ≠ total_amount → รายงาน "ต้องดูเอง"
 *
 * ความปลอดภัย:
 *   - ค่าเริ่มต้น = dry-run (พิมพ์แผน ไม่เขียน) · เขียนจริงต้อง --apply · **ปิดแอป/FrontOffice ระหว่างรัน**
 *   - --apply: backup ทุกค่าที่จะแก้ลง scripts/backups/money-to-baht-<เวลา UTC>.json ก่อน
 *   - เขียนทีละฟิลด์แบบมีเงื่อนไข { _id, field: ค่าเดิม } → ค่าเปลี่ยนระหว่างรัน = ข้าม (conflict)
 *   - ไม่แตะ updated_at · ลง marker `money_to_baht_applied` ใน migrations → รันซ้ำไม่ได้ (กัน ÷100 ซ้ำ)
 *
 * รัน: npm run migrate:money-to-baht              (dry-run)
 *      npm run migrate:money-to-baht -- --apply   (เขียนจริง)
 */

export const MARKER_ID = "money_to_baht_applied";
const BIG = 1000;

type Mode = "all" | "big-only";
interface Target {
  collection: string;
  /** ฟิลด์ตัวเลขตรง ๆ หรือ "arr.$[].key" = key ในทุกสมาชิกของ array */
  field: string;
  mode: Mode;
  filter?: Record<string, unknown>;
}

export const TARGETS: Target[] = [
  // ── ขาย (FrontOffice เขียนได้ → big-only) ──
  { collection: "products", field: "product_price", mode: "big-only" },
  { collection: "orders", field: "subtotal", mode: "big-only" },
  { collection: "orders", field: "delivery_fee", mode: "big-only" },
  { collection: "orders", field: "total_amount", mode: "big-only" },
  { collection: "orders", field: "discount_amount", mode: "all" },
  { collection: "orderitems", field: "unit_price", mode: "big-only" },
  { collection: "orderitems", field: "total_price", mode: "big-only" },
  { collection: "orderitems", field: "cost_per_unit", mode: "all" },
  { collection: "orderitems", field: "selected_options.$[].extra_price", mode: "all" },
  { collection: "payments", field: "amount", mode: "big-only" },
  { collection: "cartitems", field: "price_snapshot", mode: "big-only" },
  { collection: "cartitems", field: "selected_options.$[].extra_price", mode: "all" },
  { collection: "preorderrounditems", field: "price_override", mode: "big-only" },
  // ── สตางค์ทั้งหมด (backend เขียนอย่างเดียว) ──
  { collection: "products", field: "sale_price", mode: "all" },
  { collection: "products", field: "purchase_cost", mode: "all" },
  { collection: "productvariants", field: "variant_price", mode: "all" },
  { collection: "productoptions", field: "extra_price", mode: "all" },
  { collection: "preorders", field: "subtotal", mode: "all" },
  { collection: "preorders", field: "discount_amount", mode: "all" },
  { collection: "preorders", field: "delivery_fee", mode: "all" },
  { collection: "preorders", field: "total_amount", mode: "all" },
  { collection: "preorderitems", field: "unit_price", mode: "all" },
  { collection: "preorderitems", field: "total_price", mode: "all" },
  { collection: "preorderitems", field: "cost_per_unit", mode: "all" },
  { collection: "promotionusages", field: "discount_applied", mode: "all" },
  { collection: "promotions", field: "discount_value", mode: "all", filter: { discount_type: "Amount" } },
  { collection: "promotions", field: "min_order_amount", mode: "all" },
  { collection: "promotions", field: "max_discount_amount", mode: "all" },
  { collection: "expenses", field: "amount", mode: "all" },
  { collection: "deliveryzones", field: "fee", mode: "all" },
  { collection: "ingredients", field: "cost_per_unit", mode: "all" },
  { collection: "components", field: "estimated_cost_per_batch", mode: "all" },
  { collection: "recipes", field: "estimated_cost_per_batch", mode: "all" },
];

export interface PlannedChange {
  collection: string;
  _id: string;
  field: string;
  old: unknown;
  new: unknown;
}

export interface MoneyToBahtResult {
  dryRun: boolean;
  planned: PlannedChange[];
  /** ค่า < 1,000 ในฟิลด์ big-only ที่ถือว่าเป็นบาทอยู่แล้ว (ไม่แตะ) */
  keptAsBaht: Array<{ collection: string; _id: string; field: string; value: number }>;
  /** ออเดอร์/พรีออเดอร์ที่ยอดหลังแปลงไม่ลงตัว — ต้องดูเอง */
  review: Array<{ collection: string; _id: string; no: string; detail: string }>;
  written: number;
  conflicts: string[];
  backupFile: string | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const convert = (v: number, mode: Mode): number | null => {
  if (v === 0) return null;
  if (mode === "big-only" && v < BIG) return null;
  return round2(v / 100);
};

export async function runMigration(opts: { apply?: boolean; backupDir?: string } = {}): Promise<MoneyToBahtResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const dryRun = !opts.apply;
  const migrations = db.collection<{ _id: string; applied_at: Date; changed: number }>("migrations");
  if (await migrations.findOne({ _id: MARKER_ID })) {
    throw new Error(`เคยรัน migrate-money-to-baht --apply แล้ว (marker ${MARKER_ID}) — ห้ามรันซ้ำ (จะ ÷100 ซ้ำ)`);
  }

  const planned: PlannedChange[] = [];
  const keptAsBaht: MoneyToBahtResult["keptAsBaht"] = [];
  // ค่าหลังแปลงของออเดอร์/พรีออเดอร์ ไว้ตรวจยอดรวม
  const after = new Map<string, Record<string, unknown>>();

  for (const t of TARGETS) {
    const [top, , sub] = t.field.split(".");
    const docs = await db
      .collection(t.collection)
      .find({ [top]: { $exists: true, $ne: null }, ...(t.filter ?? {}) })
      .toArray();
    for (const d of docs) {
      const id = String(d._id);
      if (sub) {
        const arr = d[top];
        if (!Array.isArray(arr) || arr.length === 0) continue;
        let changed = false;
        const next = arr.map((el: Record<string, unknown>) => {
          const v = el?.[sub];
          if (!isNum(v)) return el;
          const n = convert(v, t.mode);
          if (n === null) return el;
          changed = true;
          return { ...el, [sub]: n };
        });
        if (changed) planned.push({ collection: t.collection, _id: id, field: top, old: arr, new: next });
        continue;
      }
      const v = d[top];
      if (!isNum(v)) continue;
      const n = convert(v, t.mode);
      if (n === null) {
        if (t.mode === "big-only" && v !== 0) keptAsBaht.push({ collection: t.collection, _id: id, field: top, value: v });
      } else {
        planned.push({ collection: t.collection, _id: id, field: top, old: v, new: n });
      }
      if (t.collection === "orders" || t.collection === "preorders") {
        const key = `${t.collection}|${id}`;
        const rec: Record<string, unknown> = after.get(key) ?? { no: d.order_no ?? d.preorder_no ?? id };
        rec[top] = n ?? v;
        after.set(key, rec);
      }
    }
  }

  const review: MoneyToBahtResult["review"] = [];
  for (const [key, r] of after) {
    const [collection, _id] = key.split("|");
    const num = (k: string) => (isNum(r[k]) ? (r[k] as number) : 0);
    const expected = round2(num("subtotal") - num("discount_amount") + num("delivery_fee"));
    if (isNum(r.total_amount) && Math.abs(expected - (r.total_amount as number)) > 0.001) {
      review.push({
        collection,
        _id,
        no: String(r.no),
        detail: `subtotal ${num("subtotal")} − ส่วนลด ${num("discount_amount")} + ค่าส่ง ${num("delivery_fee")} = ${expected} ≠ total ${String(r.total_amount)}`,
      });
    }
  }

  let written = 0;
  const conflicts: string[] = [];
  let backupFile: string | null = null;
  if (!dryRun) {
    const dir = opts.backupDir ?? "scripts/backups";
    mkdirSync(dir, { recursive: true });
    backupFile = `${dir}/money-to-baht-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(backupFile, JSON.stringify({ planned, keptAsBaht, review }, null, 2));

    for (const p of planned) {
      const res = await db
        .collection(p.collection)
        .updateOne({ _id: new mongoose.Types.ObjectId(p._id), [p.field]: p.old }, { $set: { [p.field]: p.new } });
      if (res.modifiedCount === 1) written++;
      else conflicts.push(`${p.collection}:${p._id}.${p.field}`);
    }
    await migrations.insertOne({ _id: MARKER_ID, applied_at: new Date(), changed: written });
  }

  const byCollection = planned.reduce<Record<string, number>>((a, p) => ((a[p.collection] = (a[p.collection] ?? 0) + 1), a), {});
  console.log(`migrate-money-to-baht ${dryRun ? "(DRY-RUN — ไม่ได้เขียนอะไร · ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"}`);
  console.log(`  ÷100 รวม ${planned.length} ค่า:`, byCollection);
  console.log(`  เป็นบาทอยู่แล้ว (< ${BIG}) ไม่แตะ: ${keptAsBaht.length} ค่า`);
  for (const k of keptAsBaht) console.log(`    - ${k.collection}.${k.field} ${k._id} = ${k.value}`);
  console.log(`  ยอดไม่ลงตัว — ต้องดูเอง: ${review.length}`);
  for (const r of review) console.log(`    - ${r.collection} ${r.no}: ${r.detail}`);
  if (!dryRun) {
    console.log(`  เขียนสำเร็จ: ${written} · ค่าเปลี่ยนระหว่างรัน (ข้าม): ${conflicts.length}`);
    console.log(`  backup: ${backupFile} · ลง marker ${MARKER_ID} แล้ว`);
  }

  return { dryRun, planned, keptAsBaht, review, written, conflicts, backupFile };
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI (`npm run migrate:money-to-baht`)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runMigration({ apply: process.argv.includes("--apply") })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
