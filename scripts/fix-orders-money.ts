import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import dbConnect from "../src/lib/dbConnect";

/**
 * แก้ยอดเงินของออเดอร์ที่ถูกบันทึกเป็น "บาทในช่องสตางค์" ตามรายงานของ audit-orders-money.ts
 *
 * ค่าเริ่มต้น = DRY-RUN (ไม่เขียนอะไร) — ต้องใส่ --apply ถึงจะเขียนจริง
 *
 * ขั้นตอน: npx tsx scripts/audit-orders-money.ts    (สร้าง report ใหม่ แล้วเปิดดู)
 *          npx tsx scripts/fix-orders-money.ts        (dry-run)
 *          npx tsx scripts/fix-orders-money.ts --apply
 *
 * แก้เฉพาะออเดอร์ที่ verdict = CONFIRMED_WRONG (ราคาต่อชิ้น ×100 ตรงราคาสินค้าปัจจุบัน) เท่านั้น:
 *   orderitems.unit_price / total_price · orders.subtotal / total_amount · payments.amount (ที่ตรงกับยอดออเดอร์เดิม)
 * ไม่แตะ cost_per_unit (ต้องคำนวณใหม่จากสูตร) และไม่แตะออเดอร์ที่ติด REVIEW
 *
 * ความปลอดภัย (แบบเดียวกับ fix-money-units.ts):
 *  - ปฏิเสธ report ที่เก่ากว่า 24 ชม. · ตรวจค่าปัจจุบันใน DB ตรงกับ report ก่อนเขียนทุกแถว
 *  - ก่อนเขียนใช้ filter { _id, field: ค่าเดิม } — ค่าเปลี่ยนระหว่างทางจะไม่ถูกเขียนทับ
 *  - ไม่แตะ updated_at · สำรองค่าเดิมลง scripts/backups/ ก่อนเริ่มเขียน
 *  - เขียนแบบ "ทั้งออเดอร์หรือไม่เขียนเลย": ถ้าแถวใดของออเดอร์ตรวจไม่ผ่าน จะข้ามทั้งออเดอร์ (ไม่แก้ครึ่ง ๆ กลาง ๆ)
 *  - marker money_fix_orders_applied กันรันซ้ำ (ซึ่งจะคูณ ×100 ซ้ำ)
 */

interface ItemPlan { id: string; unit_price: { now: number; proposed: number }; total_price: { now: number; proposed: number } }
interface OrderRow {
  kind: "order" | "preorder";
  id: string;
  order_no: string;
  verdict: "CONFIRMED_WRONG" | "REVIEW";
  now: { subtotal: number; total_amount: number };
  proposed: { subtotal: number; total_amount: number } | null;
  items: ItemPlan[];
  payments: { id: string; now: number; proposed: number | null }[];
}

interface Write { collection: string; _id: mongoose.Types.ObjectId; field: string; old: number; next: number; order_no: string }

const APPLY = process.argv.includes("--apply");
const REPORT = "scripts/audit-orders-money.report.json";
const MARKER = "money_fix_orders_applied";

async function main() {
  const report = JSON.parse(readFileSync(REPORT, "utf8")) as { generated_at: string; window: OrderRow[] };
  const ageH = (Date.now() - new Date(report.generated_at).getTime()) / 3_600_000;
  if (ageH > 24) throw new Error(`report เก่า ${ageH.toFixed(1)} ชม. — รัน audit-orders-money.ts ใหม่ก่อน`);

  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db");

  if (await db.collection<{ _id: string }>("migrations").findOne({ _id: MARKER })) {
    throw new Error(`เคยรัน fix-orders-money --apply สำเร็จแล้ว (marker ${MARKER}) — ห้ามรันซ้ำ`);
  }

  console.log(APPLY ? "โหมด APPLY — จะเขียนลงฐานข้อมูลจริง\n" : "โหมด DRY-RUN — ไม่เขียนอะไรลงฐานข้อมูล (ใส่ --apply เพื่อเขียนจริง)\n");

  const candidates = report.window.filter((r) => r.verdict === "CONFIRMED_WRONG" && r.proposed);
  const left = report.window.length - candidates.length;
  console.log(`report สร้างเมื่อ ${report.generated_at} · ออเดอร์ที่จะแก้ ${candidates.length} · ไม่แตะ (REVIEW) ${left}\n`);

  // ── สร้างแผนทีละออเดอร์ พร้อมตรวจกับค่าจริงใน DB ──
  const plans: { row: OrderRow; writes: Write[] }[] = [];
  const skipped: { row: OrderRow; reason: string }[] = [];

  for (const row of candidates) {
    const writes: Write[] = [];
    const oid = new mongoose.Types.ObjectId(row.id);
    const ordersCol = row.kind === "order" ? "orders" : "preorders";
    const itemsCol = row.kind === "order" ? "orderitems" : "preorderitems";
    let reason: string | null = null;

    const doc = await db.collection(ordersCol).findOne({ _id: oid });
    if (!doc) reason = "ไม่พบออเดอร์แล้ว";
    else if (doc.subtotal !== row.now.subtotal || doc.total_amount !== row.now.total_amount) {
      reason = `ยอดเปลี่ยนไปแล้ว (subtotal ${doc.subtotal}, total ${doc.total_amount})`;
    } else {
      writes.push({ collection: ordersCol, _id: oid, field: "subtotal", old: row.now.subtotal, next: row.proposed!.subtotal, order_no: row.order_no });
      writes.push({ collection: ordersCol, _id: oid, field: "total_amount", old: row.now.total_amount, next: row.proposed!.total_amount, order_no: row.order_no });
    }

    for (const it of row.items) {
      if (reason) break;
      const iid = new mongoose.Types.ObjectId(it.id);
      const idoc = await db.collection(itemsCol).findOne({ _id: iid });
      if (!idoc || idoc.unit_price !== it.unit_price.now || idoc.total_price !== it.total_price.now) {
        reason = `รายการสินค้า ${it.id} ไม่ตรงกับ report`;
        break;
      }
      writes.push({ collection: itemsCol, _id: iid, field: "unit_price", old: it.unit_price.now, next: it.unit_price.proposed, order_no: row.order_no });
      writes.push({ collection: itemsCol, _id: iid, field: "total_price", old: it.total_price.now, next: it.total_price.proposed, order_no: row.order_no });
    }

    for (const p of row.payments) {
      if (reason || p.proposed === null) continue;
      const pid = new mongoose.Types.ObjectId(p.id);
      const pdoc = await db.collection("payments").findOne({ _id: pid });
      if (!pdoc || pdoc.amount !== p.now) {
        reason = `payment ${p.id} ไม่ตรงกับ report`;
        break;
      }
      writes.push({ collection: "payments", _id: pid, field: "amount", old: p.now, next: p.proposed, order_no: row.order_no });
    }

    if (reason) skipped.push({ row, reason });
    else plans.push({ row, writes });
  }

  const baht = (s: number) => (s / 100).toFixed(2);
  for (const { row, writes } of plans) {
    console.log(`── ${row.order_no}  ยอด ${row.now.total_amount} → ${row.proposed!.total_amount} สตางค์  (${baht(row.now.total_amount)} → ${baht(row.proposed!.total_amount)} บาท)`);
    for (const w of writes) console.log(`   ${w.collection.padEnd(11)} ${w._id.toHexString().slice(-6)} ${w.field.padEnd(12)} ${String(w.old).padStart(6)} → ${String(w.next).padStart(6)}`);
  }
  const totalWrites = plans.reduce((s, p) => s + p.writes.length, 0);
  console.log(`\nจะแก้ ${plans.length} ออเดอร์ (${totalWrites} ฟิลด์) · ข้าม ${skipped.length} ออเดอร์`);
  for (const s of skipped) console.log(`   ข้าม ${s.row.order_no}: ${s.reason}`);

  if (!APPLY) {
    console.log("\nDRY-RUN จบ — ไม่มีการเขียนใด ๆ");
    return;
  }
  if (!plans.length) {
    console.log("\nไม่มีอะไรให้เขียน");
    return;
  }

  // ── สำรองก่อนเขียน ──
  mkdirSync("scripts/backups", { recursive: true });
  const backupPath = `scripts/backups/orders-fix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify(plans.flatMap((p) => p.writes.map((w) => ({ order_no: w.order_no, collection: w.collection, _id: w._id.toHexString(), field: w.field, old: w.old, new: w.next }))), null, 2)
  );
  console.log(`\nสำรองค่าเดิมแล้ว: ${backupPath}`);

  // ── เขียนทีละฟิลด์ ──
  let written = 0;
  let failed = 0;
  for (const { row, writes } of plans) {
    for (const w of writes) {
      const res = await db.collection(w.collection).updateOne({ _id: w._id, [w.field]: w.old }, { $set: { [w.field]: w.next } });
      if (res.matchedCount === 1) written++;
      else {
        failed++;
        console.log(`   ⚠️ ไม่ได้เขียน (ค่าเปลี่ยนระหว่างทาง): ${row.order_no} · ${w.collection}.${w.field}`);
      }
    }
  }
  console.log(`\nเขียนสำเร็จ ${written} ฟิลด์ · ไม่สำเร็จ ${failed} ฟิลด์`);

  if (failed === 0 && skipped.length === 0) {
    await db.collection<{ _id: string; applied_at: Date; modified_count: number }>("migrations").insertOne({ _id: MARKER, applied_at: new Date(), modified_count: written });
    console.log(`ลง marker ${MARKER} แล้ว — สคริปต์นี้จะไม่ยอมรันซ้ำ`);
  } else {
    console.log("มีบางส่วนที่ไม่สำเร็จ/ถูกข้าม → ไม่ลง marker; ตรวจ audit ใหม่ก่อนตัดสินใจรันซ้ำ (ระวังฟิลด์ที่เขียนไปแล้ว)");
  }
}

main()
  .catch((err) => {
    console.error("\nfix-orders-money ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
