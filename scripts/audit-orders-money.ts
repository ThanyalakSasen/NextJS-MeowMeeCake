import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { writeFileSync } from "node:fs";
import dbConnect from "../src/lib/dbConnect";

/**
 * ตรวจออเดอร์/พรีออเดอร์ย้อนหลังที่ยอดเงินผิดหน่วย — **อ่านอย่างเดียว ไม่เขียนอะไรลง DB**
 *
 * ที่มาของปัญหา: หลัง 2026-09-12 โค้ดเก็บ order/preorder เป็นสตางค์ แต่ราคาสินค้า/ส่วนลด/ค่าส่งใน DB
 * ยังเป็น "บาท" (fix-money-units.ts เพิ่งแก้เมื่อ 2026-09-20) ออเดอร์ที่สร้างในช่วงนั้นจึงถูกบันทึกด้วย
 * ค่าบาทในช่องสตางค์ → ผิด 100 เท่า  (เช่น 45 บาท เก็บเป็น 45 สตางค์)
 *
 * ช่วงเสี่ยง (window) = [cutoff, fixedAt)
 *   cutoff  = เวลาที่ migrate เฟส 1-2 รันจริง (marker money_to_satang_3_11_preorders ใน collection migrations)
 *             — ก่อนหน้านี้ถูกแปลง ×100 ไปแล้ว ถูกต้อง
 *   fixedAt = เวลาที่ fix-money-units.ts --apply สำเร็จ (marker money_fix_units_applied)
 *             — หลังจากนี้ราคาสินค้าเป็นสตางค์แล้ว ออเดอร์ใหม่ถูกต้อง
 *
 * ผลตรวจ 2 ส่วน:
 *  A. ออเดอร์/พรีออเดอร์ในช่วงเสี่ยง — ยืนยันด้วยหลักฐาน: unit_price × 100 ต้องตรงกับราคาสินค้าปัจจุบัน
 *     (sale_price ?? product_price ที่แก้เป็นสตางค์แล้ว) → CONFIRMED_WRONG; ไม่ตรง → REVIEW (ราคาอาจเปลี่ยนภายหลัง)
 *  B. ความสอดคล้องภายในของ "ทุกออเดอร์" (ไม่จำกัดช่วง): ผลรวม items ≠ subtotal, total ≠ subtotal − discount + fee,
 *     payment.amount ≠ total — จับความเสียหายที่เกิดนอกช่วงเสี่ยงได้ด้วย
 *
 * ค่าที่เสนอ (proposed) คำนวณให้ดูเท่านั้น: unit_price/total_price/subtotal ×100, total_amount คำนวณใหม่,
 * payment.amount ตาม total ใหม่ — discount_amount/delivery_fee ที่ไม่ใช่ 0 ติด REVIEW (ที่มาอาจเป็นบาทจากโปรโมชัน/โซน
 * หรือเป็นสตางค์จาก admin กรอกเอง แยกอัตโนมัติไม่ได้) และ cost_per_unit ไม่เสนอค่า (ต้องคำนวณใหม่จากสูตร)
 *
 * รัน:   npx tsx scripts/audit-orders-money.ts [--cutoff=ISO] [--fixed-at=ISO]
 * ผลลัพธ์: ตารางใน terminal + scripts/audit-orders-money.report.json
 */

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const baht = (satang: number) => (satang / 100).toFixed(2);

async function markerTime(db: mongoose.mongo.Db, id: string): Promise<Date | null> {
  const m = await db.collection<{ _id: string; applied_at: Date }>("migrations").findOne({ _id: id });
  return m?.applied_at ?? null;
}

interface ItemPlan {
  id: string;
  product: string;
  quantity: number;
  unit_price: { now: number; proposed: number };
  total_price: { now: number; proposed: number };
  priceEvidence: "MATCH" | "MISMATCH" | "NO_PRODUCT";
  currentProductPrice: number | null;
  hasVariantOrOptions: boolean;
  cost_per_unit: number | null;
}

interface OrderRow {
  kind: "order" | "preorder";
  id: string;
  order_no: string;
  created_at: string;
  status: string;
  payment_status: string;
  verdict: "CONFIRMED_WRONG" | "REVIEW";
  reasons: string[];
  now: { subtotal: number; discount_amount: number; delivery_fee: number; total_amount: number };
  proposed: { subtotal: number; total_amount: number } | null;
  items: ItemPlan[];
  payments: { id: string; status: string; now: number; proposed: number | null }[];
}

async function auditWindow(db: mongoose.mongo.Db, kind: "order" | "preorder", from: Date, to: Date): Promise<OrderRow[]> {
  const ordersCol = kind === "order" ? "orders" : "preorders";
  const itemsCol = kind === "order" ? "orderitems" : "preorderitems";
  const idField = kind === "order" ? "order_id" : "preorder_id";
  const noField = kind === "order" ? "order_no" : "preorder_no";

  const orders = await db.collection(ordersCol).find({ created_at: { $gte: from, $lt: to } }).sort({ created_at: 1 }).toArray();
  const rows: OrderRow[] = [];

  for (const o of orders) {
    const items = await db.collection(itemsCol).find({ [idField]: o._id }).toArray();
    const payments = await db.collection("payments").find({ [idField]: o._id }).toArray();
    const reasons: string[] = [];

    const plans: ItemPlan[] = [];
    for (const it of items) {
      const product = it.product_id ? await db.collection("products").findOne({ _id: it.product_id }) : null;
      const current = product ? (product.sale_price ?? product.product_price ?? null) : null;
      const proposedUnit = Math.round(it.unit_price * 100);
      const optExtra = (it.selected_options ?? []).reduce((s: number, x: Doc) => s + (x.extra_price ?? 0), 0);
      const hasVariantOrOptions = Boolean(it.variant_id) || (it.selected_options ?? []).length > 0;
      const evidence: ItemPlan["priceEvidence"] =
        current === null ? "NO_PRODUCT" : proposedUnit === current + Math.round(optExtra * 100) || proposedUnit === current ? "MATCH" : "MISMATCH";
      plans.push({
        id: String(it._id),
        product: String(it.product_snapshot?.product_name_th ?? product?.product_name_th ?? it.product_id),
        quantity: it.quantity,
        unit_price: { now: it.unit_price, proposed: proposedUnit },
        total_price: { now: it.total_price, proposed: Math.round(it.total_price * 100) },
        priceEvidence: evidence,
        currentProductPrice: current,
        hasVariantOrOptions,
        cost_per_unit: typeof it.cost_per_unit === "number" ? it.cost_per_unit : null,
      });
    }

    if (!plans.length) reasons.push("ไม่พบรายการสินค้าของออเดอร์นี้");
    if (plans.some((p) => p.priceEvidence !== "MATCH")) reasons.push("ราคาต่อชิ้น ×100 ไม่ตรงราคาสินค้าปัจจุบัน (ราคาอาจถูกแก้ภายหลัง หรือสินค้าถูกลบ)");
    if (plans.some((p) => p.hasVariantOrOptions)) reasons.push("มี variant/ตัวเลือกเสริม — ยังไม่ได้ตรวจราคา variant/option");
    if (o.discount_amount) reasons.push(`discount_amount = ${o.discount_amount} ไม่ใช่ 0 — แยกไม่ได้ว่าเป็นบาทจากโปรโมชันหรือสตางค์จาก admin`);
    if (o.delivery_fee) reasons.push(`delivery_fee = ${o.delivery_fee} ไม่ใช่ 0 — แยกไม่ได้ว่าเป็นบาทจากโซนหรือสตางค์จาก admin`);

    const confident = reasons.length === 0;
    const newSubtotal = Math.round(o.subtotal * 100);
    const proposed = confident
      ? { subtotal: newSubtotal, total_amount: newSubtotal - (o.discount_amount ?? 0) + (o.delivery_fee ?? 0) }
      : null;

    rows.push({
      kind,
      id: String(o._id),
      order_no: String(o[noField] ?? o._id),
      created_at: o.created_at.toISOString(),
      status: String(o.order_status ?? o.status ?? ""),
      payment_status: String(o.payment_status ?? ""),
      verdict: confident ? "CONFIRMED_WRONG" : "REVIEW",
      reasons,
      now: { subtotal: o.subtotal, discount_amount: o.discount_amount ?? 0, delivery_fee: o.delivery_fee ?? 0, total_amount: o.total_amount },
      proposed,
      items: plans,
      payments: payments.map((p) => ({
        id: String(p._id),
        status: String(p.status ?? ""),
        now: p.amount,
        // ยอดชำระที่ตรงกับยอดออเดอร์เดิมเท่านั้นถึงเสนอแก้ (ยอดที่ลูกค้าโอนจริงอาจต่างออกไป → ไม่แตะ)
        proposed: proposed && p.amount === o.total_amount ? proposed.total_amount : null,
      })),
    });
  }
  return rows;
}

interface Inconsistency { kind: string; order_no: string; created_at: string; detail: string }

/** ตรวจความสอดคล้องภายในของทุกออเดอร์ — ไม่ขึ้นกับช่วงเวลา */
async function auditConsistency(db: mongoose.mongo.Db): Promise<Inconsistency[]> {
  const out: Inconsistency[] = [];
  const orders = await db.collection("orders").find({ deleted_at: null }).toArray();
  for (const o of orders) {
    const at = o.created_at.toISOString();
    const items = await db.collection("orderitems").find({ order_id: o._id }).toArray();
    const sum = items.reduce((s, i) => s + (i.total_price ?? 0), 0);
    if (items.length && sum !== o.subtotal) out.push({ kind: "items_sum≠subtotal", order_no: o.order_no, created_at: at, detail: `รวมรายการ ${sum} vs subtotal ${o.subtotal}` });
    const expect = o.subtotal - (o.discount_amount ?? 0) + (o.delivery_fee ?? 0);
    if (expect !== o.total_amount) out.push({ kind: "total≠sub−disc+fee", order_no: o.order_no, created_at: at, detail: `คำนวณได้ ${expect} vs total ${o.total_amount}` });
    for (const it of items) {
      if (it.unit_price * it.quantity !== it.total_price) out.push({ kind: "unit×qty≠total", order_no: o.order_no, created_at: at, detail: `${it.unit_price}×${it.quantity} vs ${it.total_price}` });
      if (!Number.isInteger(it.unit_price) || !Number.isInteger(it.total_price)) out.push({ kind: "ไม่ใช่ integer สตางค์", order_no: o.order_no, created_at: at, detail: `unit ${it.unit_price} / total ${it.total_price}` });
    }
    const pays = await db.collection("payments").find({ order_id: o._id, deleted_at: null }).toArray();
    for (const p of pays) {
      if (p.amount !== o.total_amount) out.push({ kind: "payment≠total", order_no: o.order_no, created_at: at, detail: `payment ${p.amount} vs total ${o.total_amount}` });
    }
  }
  return out;
}

async function main() {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db");

  const cutoff = arg("cutoff") ? new Date(arg("cutoff")!) : await markerTime(db, "money_to_satang_3_11_preorders");
  const fixedAt = arg("fixed-at") ? new Date(arg("fixed-at")!) : await markerTime(db, "money_fix_units_applied");
  if (!cutoff) throw new Error("หา cutoff ไม่เจอ (ไม่มี marker money_to_satang_3_11_preorders) — ระบุ --cutoff=ISO");
  if (!fixedAt) throw new Error("หา fixedAt ไม่เจอ (ไม่มี marker money_fix_units_applied) — ระบุ --fixed-at=ISO");

  console.log("ตรวจออเดอร์ย้อนหลัง (อ่านอย่างเดียว)");
  console.log(`ช่วงเสี่ยง: ${cutoff.toISOString()}  →  ${fixedAt.toISOString()}\n`);

  const orderRows = await auditWindow(db, "order", cutoff, fixedAt);
  const preorderRows = await auditWindow(db, "preorder", cutoff, fixedAt);
  const rows = [...orderRows, ...preorderRows];

  console.log(`A. ในช่วงเสี่ยง: ออเดอร์ ${orderRows.length} · พรีออเดอร์ ${preorderRows.length}\n`);
  for (const r of rows) {
    const tag = r.verdict === "CONFIRMED_WRONG" ? "ยืนยันว่าผิด" : "ต้องดูเอง  ";
    console.log(`[${tag}] ${r.order_no} · ${r.created_at.slice(0, 16)} · ${r.status}/${r.payment_status}`);
    console.log(`   ยอดตอนนี้ ${r.now.total_amount} สตางค์ (แสดงเป็น ${baht(r.now.total_amount)} บาท)` + (r.proposed ? `  →  ควรเป็น ${r.proposed.total_amount} สตางค์ (${baht(r.proposed.total_amount)} บาท)` : ""));
    for (const it of r.items) {
      console.log(`   - ${it.product.slice(0, 26)} ×${it.quantity}: ${it.unit_price.now} → ${it.unit_price.proposed}  [ราคาสินค้าปัจจุบัน ${it.currentProductPrice ?? "?"}: ${it.priceEvidence}]`);
    }
    for (const p of r.payments) console.log(`   - payment ${p.status}: ${p.now}` + (p.proposed !== null ? ` → ${p.proposed}` : "  (ไม่เสนอแก้)"));
    for (const why of r.reasons) console.log(`   ⚠️ ${why}`);
  }

  const wrongRevenue = rows.filter((r) => r.verdict === "CONFIRMED_WRONG" && r.payment_status === "paid");
  const missing = wrongRevenue.reduce((s, r) => s + (r.proposed!.total_amount - r.now.total_amount), 0);
  console.log(`\nรายได้ที่ขาดหายไปใน dashboard (เฉพาะที่ยืนยันแล้วและจ่ายแล้ว ${wrongRevenue.length} ใบ): ${baht(missing)} บาท`);

  const incons = await auditConsistency(db);
  console.log(`\nB. ความสอดคล้องภายในของทุกออเดอร์: พบ ${incons.length} รายการ`);
  const byKind = new Map<string, number>();
  for (const i of incons) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  for (const [k, n] of byKind) console.log(`   ${k}: ${n}`);
  for (const i of incons.slice(0, 12)) console.log(`   · ${i.order_no} (${i.created_at.slice(0, 10)}) ${i.kind}: ${i.detail}`);
  if (incons.length > 12) console.log(`   ... อีก ${incons.length - 12} รายการ (ดูทั้งหมดใน report)`);

  const out = "scripts/audit-orders-money.report.json";
  writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), cutoff, fixedAt, window: rows, inconsistencies: incons }, null, 2));
  console.log(`\nรายงานเต็ม: ${out}\nสคริปต์นี้ไม่ได้เขียนอะไรลงฐานข้อมูล`);
}

main()
  .catch((err) => {
    console.error("\naudit-orders-money ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
