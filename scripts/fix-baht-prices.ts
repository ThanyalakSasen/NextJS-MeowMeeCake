import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import { MIN_PLAUSIBLE_PRICE_SATANG } from "../src/services/dataIntegrityService";

/**
 * docs/BACKLOG4.md R7 — ราคาที่ถูกเขียนเป็น "บาท" (นอก API — แบบเดียวกับ BACKLOG2 §16) → ×100 กลับเป็นสตางค์
 *
 * เป้าหมาย (ค่าต่ำกว่า MIN_PLAUSIBLE_PRICE_SATANG = 1,000 สตางค์ / 10 บาท — เกณฑ์เดียวกับ check:data-integrity):
 *   products.product_price              (รวมสินค้าที่ลบแล้ว — กู้คืนแล้วราคาจะได้ไม่เพี้ยน)
 *   preorderrounditems.price_override   (ไม่ null)
 *   cartitems.price_snapshot            (ตะกร้าที่ยังไม่ถูกลบ — ตอนสั่งจริงคิดราคาใหม่อยู่แล้ว แต่ให้แสดงถูก)
 * ไม่แตะ sale_price (ตรวจแล้วเป็นสตางค์ถูกต้อง) · ไม่แตะออเดอร์ที่สร้างไปแล้ว (ให้คนตัดสินใจ)
 *
 * ความปลอดภัย:
 *   - ค่าเริ่มต้น = dry-run (พิมพ์แผน ไม่เขียน) · เขียนจริงต้อง --apply
 *   - ค่ามีทศนิยม = ไม่ใช่อาการนี้ → หยุดทั้งหมด ไม่เขียนอะไร
 *   - --apply: backup scripts/backups/money-fix-<เวลา UTC>.json ก่อน (audit-money-units อ่านไฟล์นี้ได้ — Y10)
 *   - เขียนทีละแถวแบบมีเงื่อนไข { _id, field: ค่าเดิม } → ใครแก้ระหว่างรัน = ข้าม · ไม่แตะ updated_at (เก็บหลักฐานเวลา)
 *   - รันซ้ำได้: แก้แล้วค่า ≥ 1,000 จะไม่ถูกเลือกอีก
 *
 * รัน: npm run fix:baht-prices              (dry-run)
 *      npm run fix:baht-prices -- --apply   (เขียนจริง)
 * แล้วยืนยัน: npm run check:data-integrity -- --no-notify
 */

export interface PricePlan {
  collection: "products" | "preorderrounditems" | "cartitems";
  _id: string;
  field: "product_price" | "price_override" | "price_snapshot";
  old: number;
  new: number;
  label: string;
}

export interface FixBahtPricesResult {
  dryRun: boolean;
  planned: PricePlan[];
  written: number;
  conflicts: string[];
  backupFile: string | null;
}

export async function runFix(opts: { apply?: boolean; backupDir?: string } = {}): Promise<FixBahtPricesResult> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");
  const dryRun = !opts.apply;
  const low = { $type: "number", $lt: MIN_PLAUSIBLE_PRICE_SATANG };

  const planned: PricePlan[] = [];
  for (const p of await db.collection("products").find({ product_price: low }).toArray()) {
    planned.push({
      collection: "products",
      _id: String(p._id),
      field: "product_price",
      old: p.product_price,
      new: Math.round(p.product_price * 100),
      label: `${p.product_id ?? ""} ${p.product_name_th ?? ""}${p.deleted_at ? " (ลบแล้ว)" : ""}`.trim(),
    });
  }
  for (const r of await db.collection("preorderrounditems").find({ price_override: low }).toArray()) {
    planned.push({
      collection: "preorderrounditems",
      _id: String(r._id),
      field: "price_override",
      old: r.price_override,
      new: Math.round(r.price_override * 100),
      label: `รอบ ${String(r.round_id)}`,
    });
  }
  for (const c of await db.collection("cartitems").find({ deleted_at: null, price_snapshot: low }).toArray()) {
    planned.push({
      collection: "cartitems",
      _id: String(c._id),
      field: "price_snapshot",
      old: c.price_snapshot,
      new: Math.round(c.price_snapshot * 100),
      label: `ตะกร้า ${String(c.cart_id)}`,
    });
  }

  const fractional = planned.filter((p) => !Number.isInteger(p.old));
  if (fractional.length) {
    throw new Error(
      `พบค่ามีทศนิยม ${fractional.length} แถว (ไม่ใช่อาการ "บาทจำนวนเต็ม") — หยุด ไม่เขียนอะไร: ` +
        fractional.map((p) => `${p.collection}:${p._id}=${p.old}`).join(", ")
    );
  }

  let written = 0;
  const conflicts: string[] = [];
  let backupFile: string | null = null;
  if (!dryRun && planned.length) {
    const dir = opts.backupDir ?? "scripts/backups";
    mkdirSync(dir, { recursive: true });
    backupFile = `${dir}/money-fix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(backupFile, JSON.stringify(planned.map((p) => ({ ...p, reason: "BACKLOG4 R7" })), null, 2));

    for (const p of planned) {
      const res = await db
        .collection(p.collection)
        .updateOne({ _id: new mongoose.Types.ObjectId(p._id), [p.field]: p.old }, { $set: { [p.field]: p.new } });
      if (res.modifiedCount === 1) written++;
      else conflicts.push(`${p.collection}:${p._id}`);
    }
  }

  const count = (c: PricePlan["collection"]) => planned.filter((p) => p.collection === c).length;
  console.log(`fix-baht-prices ${dryRun ? "(DRY-RUN — ไม่ได้เขียนอะไร · ใส่ --apply เพื่อเขียนจริง)" : "(APPLY)"}`);
  console.log(
    `  จะ ×100: สินค้า ${count("products")} · ราคารอบพรีออเดอร์ ${count("preorderrounditems")} · ตะกร้า ${count("cartitems")}`
  );
  for (const p of planned) console.log(`    - ${p.collection}.${p.field} ${p.label}: ${p.old} → ${p.new}`);
  if (!dryRun) {
    console.log(`  เขียนสำเร็จ: ${written} · ค่าเปลี่ยนระหว่างรัน (ข้าม): ${conflicts.length}`);
    if (backupFile) console.log(`  สำรองค่าเดิม: ${backupFile}`);
  }

  return { dryRun, planned, written, conflicts, backupFile };
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI (`npm run fix:baht-prices`)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runFix({ apply: process.argv.includes("--apply") })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
