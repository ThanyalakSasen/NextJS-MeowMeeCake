import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { writeFileSync } from "node:fs";
import dbConnect from "../src/lib/dbConnect";

/**
 * ตรวจหน่วยเงินในฐานข้อมูลหลัง migrate:money-to-satang ที่รันไม่ครบ — **อ่านอย่างเดียว ไม่เขียนอะไรลง DB**
 *
 * ปัญหา: เฟส 3-5b ไม่เคยถูกรัน ข้อมูลใน collection เหล่านั้นจึงยังเป็น "บาท" ทั้งที่โค้ดหาร 100 แล้ว
 * แต่แถวที่ถูกสร้าง/แก้ไขหลังโค้ดเปลี่ยน (cutoff) ถูกบันทึกเป็น "สตางค์" ถูกต้องไปแล้ว
 * จึงรัน migrate ซ้ำตรง ๆ ไม่ได้ (จะคูณซ้ำ 100 เท่า) — สคริปต์นี้แยกแยะให้เป็นรายแถว
 *
 * เกณฑ์แยก (สตางค์เป็น integer เสมอ):
 *   BAHT_CERTAIN   ค่ามีทศนิยม                          → ยังเป็นบาทแน่นอน (สตางค์ไม่มีทางมีทศนิยม)
 *   BAHT_LIKELY    ค่าเป็น integer + updated_at < cutoff → น่าจะยังเป็นบาท (ไม่มีใครแตะตั้งแต่ก่อนโค้ดเปลี่ยน)
 *   SATANG_LIKELY  ค่าเป็น integer + updated_at ≥ cutoff → น่าจะเป็นสตางค์แล้ว (ห้ามคูณซ้ำ)
 *   REVIEW         ตัดสินไม่ได้ (ไม่มี updated_at) หรือค่าขัดกับเกณฑ์ เช่น SATANG_LIKELY แต่ค่า < 1000
 *                  หรือ BAHT_LIKELY แต่ค่า ≥ 100000 → ต้องคนดูเอง
 *
 * รัน:   npx tsx scripts/audit-money-units.ts [--cutoff=2026-09-12T14:14:00Z] [--verbose]
 * ผลลัพธ์: สรุปตารางใน terminal + รายละเอียดทุกแถวที่ "จะแก้" ใน scripts/audit-money-units.report.json
 */

type Verdict = "BAHT_CERTAIN" | "BAHT_LIKELY" | "SATANG_LIKELY" | "REVIEW";

interface Target {
  /** id ตรงกับ section ใน migrate-money-to-satang.ts */
  section: string;
  collection: string;
  /** path ของฟิลด์เงิน — "a.$[].b" = ทุกสมาชิกของ array a ฟิลด์ b */
  field: string;
  /** เงื่อนไขกรองเอกสารก่อนตรวจ (เช่น promotions เฉพาะ discount_type = Amount) */
  filter?: Record<string, unknown>;
  /** ฟิลด์ที่ใช้แสดงชื่อแถวในรายงาน */
  label: string;
}

const TARGETS: Target[] = [
  // เฟส 3
  { section: "delivery_zones", collection: "deliveryzones", field: "fee", label: "zone_name" },
  // เฟส 4
  { section: "ingredients", collection: "ingredients", field: "cost_per_unit", label: "ingredient_name" },
  { section: "components", collection: "components", field: "estimated_cost_per_batch", label: "component_name" },
  { section: "recipes", collection: "recipes", field: "estimated_cost_per_batch", label: "recipe_name" },
  { section: "products_purchase_cost", collection: "products", field: "purchase_cost", label: "product_name_th" },
  { section: "order_items_cost_per_unit", collection: "orderitems", field: "cost_per_unit", label: "_id" },
  { section: "preorder_items_cost_per_unit", collection: "preorderitems", field: "cost_per_unit", label: "_id" },
  // เฟส 5a — discount_value คูณเฉพาะ Amount (Percentage เป็นเลข % ห้ามแตะ)
  { section: "promotions.discount_value", collection: "promotions", field: "discount_value", filter: { discount_type: "Amount" }, label: "promotion_name" },
  { section: "promotions.min_order_amount", collection: "promotions", field: "min_order_amount", label: "promotion_name" },
  { section: "promotions.max_discount_amount", collection: "promotions", field: "max_discount_amount", label: "promotion_name" },
  // เฟส 5b
  { section: "products.product_price", collection: "products", field: "product_price", label: "product_name_th" },
  { section: "products.sale_price", collection: "products", field: "sale_price", label: "product_name_th" },
  { section: "product_variants", collection: "productvariants", field: "variant_price", label: "_id" },
  { section: "product_options", collection: "productoptions", field: "extra_price", label: "_id" },
  { section: "cart_items.price_snapshot", collection: "cartitems", field: "price_snapshot", label: "_id" },
  { section: "cart_items.selected_options", collection: "cartitems", field: "selected_options.$[].extra_price", label: "_id" },
  { section: "preorder_round_items", collection: "preorderrounditems", field: "price_override", label: "_id" },
];

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const cutoffArg = args.find((a) => a.startsWith("--cutoff="))?.split("=")[1];
// ดีฟอลต์ = เวลาที่เฟส 1-2 รันจริง (marker ล่าสุดใน collection migrations) — ตั้งเองได้ถ้ารู้เวลา deploy โค้ดสตางค์
const CUTOFF = new Date(cutoffArg ?? "2026-09-12T14:14:00Z");

/** ดึงค่าตัวเลขทุกตัวที่ path ชี้ไป (รองรับ "$[]" = กระจาย array) */
function extract(doc: Record<string, unknown>, path: string): number[] {
  let cur: unknown[] = [doc];
  for (const seg of path.split(".")) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (seg === "$[]") {
        if (Array.isArray(c)) next.push(...c);
      } else if (c && typeof c === "object") {
        next.push((c as Record<string, unknown>)[seg]);
      }
    }
    cur = next;
  }
  return cur.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/** ตัดสินทั้งแถว — ถ้ามีหลายค่า (array) ใช้ค่าที่ "เสี่ยงที่สุด" เป็นตัวแทน */
function classify(values: number[], updatedAt: Date | null): Verdict {
  if (values.some((v) => !Number.isInteger(v))) return "BAHT_CERTAIN";
  if (!updatedAt) return "REVIEW";
  const max = Math.max(...values);
  if (updatedAt >= CUTOFF) return max < 1000 ? "REVIEW" : "SATANG_LIKELY";
  return max >= 100_000 ? "REVIEW" : "BAHT_LIKELY";
}

interface Row {
  section: string;
  collection: string;
  id: string;
  label: string;
  field: string;
  verdict: Verdict;
  updated_at: string | null;
  current: number[];
  /** ค่าที่จะได้ถ้า migrate แถวนี้ (×100) — ใส่เฉพาะแถวที่ verdict เป็น BAHT_* */
  proposed: number[] | null;
  /** ค่าที่ API แสดงอยู่ตอนนี้ (÷100) เทียบกับค่าที่ควรเป็น */
  shown_now_baht: number[];
}

async function main() {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db");

  console.log(`ตรวจหน่วยเงิน (อ่านอย่างเดียว) — cutoff = ${CUTOFF.toISOString()}\n`);

  const applied = new Set((await db.collection("migrations").find({}).toArray()).map((m) => String(m._id)));
  const rows: Row[] = [];
  const table: Record<string, Record<Verdict, number>> = {};

  for (const t of TARGETS) {
    const cols = await db.listCollections({ name: t.collection }).toArray();
    if (!cols.length) {
      console.log(`  (ข้าม) ไม่พบ collection ${t.collection}`);
      continue;
    }
    const topField = t.field.split(".")[0];
    const docs = await db
      .collection(t.collection)
      .find({ [topField]: { $exists: true, $ne: null }, ...(t.filter ?? {}) })
      .toArray();

    const bucket = (table[t.section] ??= { BAHT_CERTAIN: 0, BAHT_LIKELY: 0, SATANG_LIKELY: 0, REVIEW: 0 });
    for (const d of docs) {
      const values = extract(d as Record<string, unknown>, t.field);
      if (!values.length) continue;
      const updatedAt = d.updated_at instanceof Date ? d.updated_at : d.updatedAt instanceof Date ? d.updatedAt : null;
      const verdict = classify(values, updatedAt);
      bucket[verdict]++;
      const isBaht = verdict === "BAHT_CERTAIN" || verdict === "BAHT_LIKELY";
      rows.push({
        section: t.section,
        collection: t.collection,
        id: String(d._id),
        label: String((d as Record<string, unknown>)[t.label] ?? d._id),
        field: t.field,
        verdict,
        updated_at: updatedAt?.toISOString() ?? null,
        current: values,
        proposed: isBaht ? values.map((v) => Math.round(v * 100)) : null,
        shown_now_baht: values.map((v) => v / 100),
      });
    }
  }

  // ── สรุปตาราง ──
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad("section", 34) + pad("BAHT_CERT", 11) + pad("BAHT_LIKELY", 13) + pad("SATANG_LIKELY", 15) + "REVIEW");
  console.log("-".repeat(80));
  const total: Record<Verdict, number> = { BAHT_CERTAIN: 0, BAHT_LIKELY: 0, SATANG_LIKELY: 0, REVIEW: 0 };
  for (const [s, c] of Object.entries(table)) {
    console.log(pad(s, 34) + pad(String(c.BAHT_CERTAIN), 11) + pad(String(c.BAHT_LIKELY), 13) + pad(String(c.SATANG_LIKELY), 15) + c.REVIEW);
    for (const k of Object.keys(total) as Verdict[]) total[k] += c[k];
  }
  console.log("-".repeat(80));
  console.log(pad("รวม", 34) + pad(String(total.BAHT_CERTAIN), 11) + pad(String(total.BAHT_LIKELY), 13) + pad(String(total.SATANG_LIKELY), 15) + total.REVIEW);

  // marker ของ section ที่ migrate ไปแล้ว — เตือนถ้าตรวจเจอ BAHT ใน collection ที่ marker บอกว่าแปลงแล้ว
  const appliedFor = (s: string) => [...applied].some((m) => m.includes(s.split(".")[0]));
  const suspicious = Object.entries(table).filter(([s, c]) => appliedFor(s) && (c.BAHT_CERTAIN > 0));
  if (suspicious.length) {
    console.log("\n⚠️  section ที่ marker บอกว่า migrate แล้ว แต่ยังเจอค่าทศนิยม (ผิดปกติ):");
    for (const [s] of suspicious) console.log(`   - ${s}`);
  }

  // ── รายละเอียดแถวที่จะแก้ / ต้องดู ──
  const toFix = rows.filter((r) => r.proposed);
  const review = rows.filter((r) => r.verdict === "REVIEW");
  console.log(`\nแถวที่จะแก้ (×100): ${toFix.length} · ต้องคนดูเอง: ${review.length} · ปล่อยไว้ (สตางค์แล้ว): ${total.SATANG_LIKELY}`);

  const show = (title: string, list: Row[]) => {
    if (!list.length) return;
    console.log(`\n=== ${title} ===`);
    const limit = VERBOSE ? list.length : 8;
    for (const r of list.slice(0, limit)) {
      const arrow = r.proposed ? `  →  ${r.proposed.join(", ")} สตางค์` : "";
      console.log(`  [${r.verdict}] ${r.section} · ${r.label.slice(0, 28)} · ${r.field} = ${r.current.join(", ")}${arrow}  (updated ${r.updated_at?.slice(0, 10) ?? "?"})`);
    }
    if (list.length > limit) console.log(`  ... อีก ${list.length - limit} แถว (ใส่ --verbose เพื่อดูทั้งหมด)`);
  };
  show("จะแก้ — ยังเป็นบาท", toFix);
  show("ต้องคนดูเอง (REVIEW)", review);
  show("ปล่อยไว้ — น่าจะเป็นสตางค์แล้ว (ห้ามคูณซ้ำ)", rows.filter((r) => r.verdict === "SATANG_LIKELY"));

  const out = "scripts/audit-money-units.report.json";
  writeFileSync(out, JSON.stringify({ cutoff: CUTOFF.toISOString(), generated_at: new Date().toISOString(), summary: table, rows }, null, 2));
  console.log(`\nรายงานเต็ม (ทุกแถว): ${out}`);
  console.log("สคริปต์นี้ไม่ได้เขียนอะไรลงฐานข้อมูล");
}

main()
  .catch((err) => {
    console.error("\naudit-money-units ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
