import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import dbConnect from "../src/lib/dbConnect";

/**
 * แก้ข้อมูลเงินที่ยังเป็น "บาท" ให้เป็น "สตางค์" ทีละแถว ตามรายงานของ audit-money-units.ts
 *
 * ค่าเริ่มต้น = DRY-RUN (ไม่เขียนอะไร) — ต้องใส่ --apply ถึงจะเขียนจริง
 *
 * ขั้นตอน: npx tsx scripts/audit-money-units.ts   (สร้าง report ใหม่ แล้วเปิดดู)
 *          npx tsx scripts/fix-money-units.ts       (dry-run)
 *          npx tsx scripts/fix-money-units.ts --apply
 *
 * ความปลอดภัย:
 *  - แก้เฉพาะแถวใน report เท่านั้น (ไม่มี updateMany ทั้ง collection) และปฏิเสธ report ที่เก่ากว่า 24 ชม.
 *  - ก่อนเขียนแต่ละแถวใช้ filter { _id, field: ค่าเดิม } — ถ้าค่าเปลี่ยนไประหว่างนั้น จะไม่เขียนทับ (นับเป็น skipped)
 *  - เขียนผ่าน driver ตรง ๆ ไม่แตะ updated_at (ไม่ทำให้หลักฐานเวลาแก้ไขเดิมหาย)
 *  - สำรองค่าเดิมทุกแถวลง scripts/backups/ ก่อนเริ่มเขียน
 *  - ไม่แตะ order_items.cost_per_unit (ค่าคลาดเคลื่อนจากต้นทุนสูตร ต้องคำนวณใหม่ ไม่ใช่คูณ 100)
 *  - เมื่อแก้ครบโดยไม่มี skipped จะลง marker ใน collection `migrations` ของ section ที่เกี่ยวข้อง
 *    เพื่อให้ `npm run migrate:money-to-satang` กลายเป็น no-op ไม่คูณซ้ำแถวที่แก้แล้ว
 */

interface ReportRow {
  section: string;
  collection: string;
  id: string;
  label: string;
  field: string;
  verdict: "BAHT_CERTAIN" | "BAHT_LIKELY" | "SATANG_LIKELY" | "REVIEW";
  current: number[];
}

/** section ที่ REVIEW ได้รับการยืนยันจากผู้ใช้แล้วว่าเป็นบาท (updated_at ถูกดันจากการตัดสต็อก) */
const APPROVED_REVIEW_SECTIONS = new Set([
  "products.product_price",
  "products.sale_price",
  "cart_items.price_snapshot",
  "recipes",
]);
/** section ที่ห้ามแก้ด้วยการคูณ 100 เด็ดขาด */
const NEVER_FIX = new Set(["order_items_cost_per_unit"]);

/** section ใน report → marker id ที่ migrate-money-to-satang.ts ใช้ */
const MARKERS: Record<string, string> = {
  delivery_zones: "delivery_zones",
  ingredients: "ingredients",
  components: "components",
  recipes: "recipes",
  products_purchase_cost: "products_purchase_cost",
  preorder_items_cost_per_unit: "preorder_items_cost_per_unit",
  "promotions.discount_value": "promotions",
  "promotions.min_order_amount": "promotions",
  "promotions.max_discount_amount": "promotions",
  "products.product_price": "products_pricing",
  "products.sale_price": "products_pricing",
  product_variants: "product_variants",
  product_options: "product_options",
  "cart_items.price_snapshot": "cart_items",
  "cart_items.selected_options": "cart_items",
  preorder_round_items: "preorder_round_items",
};
const markerId = (name: string) => `money_to_satang_3_11_${name}`;

const APPLY = process.argv.includes("--apply");
const REPORT = "scripts/audit-money-units.report.json";

async function main() {
  const report = JSON.parse(readFileSync(REPORT, "utf8")) as { generated_at: string; rows: ReportRow[] };
  const ageH = (Date.now() - new Date(report.generated_at).getTime()) / 3_600_000;
  if (ageH > 24) {
    throw new Error(`report เก่า ${ageH.toFixed(1)} ชม. — รัน audit-money-units.ts ใหม่ก่อน`);
  }

  const targets = report.rows.filter(
    (r) =>
      !NEVER_FIX.has(r.section) &&
      (r.verdict === "BAHT_CERTAIN" || r.verdict === "BAHT_LIKELY" || (r.verdict === "REVIEW" && APPROVED_REVIEW_SECTIONS.has(r.section)))
  );
  const unsupported = targets.filter((r) => r.field.includes("$[]") || r.current.length !== 1);
  if (unsupported.length) {
    throw new Error(`ยังไม่รองรับฟิลด์แบบ array (${unsupported.length} แถว, เช่น ${unsupported[0].field}) — แก้สคริปต์ก่อน`);
  }

  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db");

  // กันรันซ้ำ: audit เกณฑ์วันที่แยกค่าที่แก้แล้วออกจากค่าบาทไม่ได้ (สคริปต์นี้ไม่แตะ updated_at)
  // ถ้ารัน audit ใหม่หลังแก้ แล้ว fix --apply ซ้ำ ข้อมูลจะถูกคูณ 100 ซ้ำ — marker นี้กันไว้ทั้ง dry-run และ apply
  if (await db.collection<{ _id: string }>("migrations").findOne({ _id: "money_fix_units_applied" })) {
    throw new Error("เคยรัน fix-money-units --apply สำเร็จแล้ว (marker money_fix_units_applied) — ห้ามรันซ้ำ");
  }

  console.log(APPLY ? "โหมด APPLY — จะเขียนลงฐานข้อมูลจริง\n" : "โหมด DRY-RUN — ไม่เขียนอะไรลงฐานข้อมูล (ใส่ --apply เพื่อเขียนจริง)\n");
  console.log(`report สร้างเมื่อ ${report.generated_at} · แถวเป้าหมาย ${targets.length}\n`);

  // ── ตรวจสอบกับค่าปัจจุบันใน DB ทีละแถว (ทั้ง dry-run และ apply) ──
  interface Plan { row: ReportRow; oid: mongoose.Types.ObjectId; oldValue: number; newValue: number }
  const plans: Plan[] = [];
  const skipped: { row: ReportRow; reason: string }[] = [];

  for (const row of targets) {
    const oid = new mongoose.Types.ObjectId(row.id);
    const doc = await db.collection(row.collection).findOne({ _id: oid });
    const live = doc?.[row.field];
    const expected = row.current[0];
    if (!doc) { skipped.push({ row, reason: "ไม่พบเอกสารแล้ว" }); continue; }
    if (live !== expected) { skipped.push({ row, reason: `ค่าเปลี่ยนไปแล้ว (report=${expected}, ตอนนี้=${live})` }); continue; }
    if (row.section === "promotions.discount_value" && doc.discount_type !== "Amount") {
      skipped.push({ row, reason: `discount_type=${doc.discount_type} (ไม่ใช่ Amount)` });
      continue;
    }
    plans.push({ row, oid, oldValue: expected, newValue: Math.round(expected * 100) });
  }

  // ── แสดงแผน จัดกลุ่มตาม section ──
  const bySection = new Map<string, Plan[]>();
  for (const p of plans) bySection.set(p.row.section, [...(bySection.get(p.row.section) ?? []), p]);
  for (const [section, list] of bySection) {
    console.log(`── ${section}  (${list.length} แถว)`);
    for (const p of list.slice(0, 5)) {
      console.log(`   ${p.row.label.slice(0, 30).padEnd(31)} ${String(p.oldValue).padStart(8)}  →  ${String(p.newValue).padStart(9)} สตางค์  (แสดงผล ${p.oldValue} บาท)`);
    }
    if (list.length > 5) console.log(`   ... อีก ${list.length - 5} แถว`);
  }
  console.log(`\nจะแก้ ${plans.length} แถว · ข้าม ${skipped.length} แถว`);
  for (const s of skipped) console.log(`   ข้าม ${s.row.section} · ${s.row.label}: ${s.reason}`);

  if (!APPLY) {
    console.log("\nDRY-RUN จบ — ไม่มีการเขียนใด ๆ");
    return;
  }

  // ── สำรองก่อนเขียน ──
  mkdirSync("scripts/backups", { recursive: true });
  const backupPath = `scripts/backups/money-fix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify(plans.map((p) => ({ collection: p.row.collection, _id: p.row.id, field: p.row.field, old: p.oldValue, new: p.newValue })), null, 2)
  );
  console.log(`\nสำรองค่าเดิมแล้ว: ${backupPath}`);

  // ── เขียนทีละแถว ──
  let done = 0;
  let raced = 0;
  const doneBySection: Record<string, number> = {};
  for (const p of plans) {
    const res = await db
      .collection(p.row.collection)
      .updateOne({ _id: p.oid, [p.row.field]: p.oldValue }, { $set: { [p.row.field]: p.newValue } });
    // matchedCount (ไม่ใช่ modifiedCount) — ค่า 0 → 0 ไม่ถือว่า "แก้" แต่ก็ไม่ใช่ความล้มเหลว
    if (res.matchedCount === 1) {
      done++;
      doneBySection[p.row.section] = (doneBySection[p.row.section] ?? 0) + 1;
    } else {
      raced++;
      console.log(`   ⚠️ ไม่ได้เขียน (ค่าเปลี่ยนระหว่างทาง): ${p.row.section} · ${p.row.label}`);
    }
  }
  console.log(`\nเขียนสำเร็จ ${done} แถว · ไม่ได้เขียน ${raced} แถว`);

  // ── marker กัน migrate รันซ้ำ — เฉพาะเมื่อไม่มีอะไรตกหล่นเลย ──
  if (raced === 0 && skipped.length === 0) {
    const col = db.collection<{ _id: string; applied_at: Date; modified_count: number }>("migrations");
    const counts: Record<string, number> = {};
    for (const [section, n] of Object.entries(doneBySection)) {
      const m = MARKERS[section];
      if (m) counts[m] = (counts[m] ?? 0) + n;
    }
    // section ที่ตรวจแล้วไม่มีแถวต้องแก้เลย ก็ลง marker ด้วย ไม่งั้น migrate จะคูณแถวที่เป็นสตางค์อยู่แล้ว
    for (const m of new Set(Object.values(MARKERS))) counts[m] ??= 0;
    for (const [m, n] of Object.entries(counts)) {
      if (!(await col.findOne({ _id: markerId(m) }))) {
        await col.insertOne({ _id: markerId(m), applied_at: new Date(), modified_count: n });
      }
    }
    await col.insertOne({ _id: "money_fix_units_applied", applied_at: new Date(), modified_count: done });
    console.log(`ลง marker ใน migrations แล้ว ${Object.keys(counts).length} ตัว — migrate:money-to-satang จะข้าม section เหล่านี้`);
    console.log("หมายเหตุ: ไม่ลง marker ของ order_items_cost_per_unit (ยังต้องคำนวณต้นทุนใหม่)");
  } else {
    console.log("มีแถวที่ข้าม/เขียนไม่สำเร็จ → ไม่ลง marker; รัน audit ใหม่แล้วรัน fix ซ้ำ");
  }
}

main()
  .catch((err) => {
    console.error("\nfix-money-units ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
