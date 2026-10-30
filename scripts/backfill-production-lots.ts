import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import dbConnect from "../src/lib/dbConnect";
import productionOrderModel from "../src/models/productionOrderModel";
import productLotModel from "../src/models/productLotModel";
import { createLotsForProduction } from "../src/services/productLotService";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * สร้างล็อต (+ รหัสประจำชิ้น) ย้อนหลังให้ใบสั่งผลิตที่ปิดงาน (done) ก่อนมีระบบล็อต — เดิมกด "พิมพ์ฉลาก" แล้วขึ้น "ไม่มีล็อต"
 *   - ใช้ค่าเริ่มต้นเดียวกับตอนปิดงาน: วันผลิต = production_date · หมดอายุ = วันผลิต + อายุสินค้า · จำนวน = ที่เพิ่มสต็อกจริง
 *   - qty_remaining ของล็อตย้อนหลัง = 0 (ของล็อตเก่าขาย/หมดไปแล้ว — ไม่ให้ขึ้นเป็นล็อตที่ยังมีของ) · พรีออเดอร์คง null
 *   - ข้ามใบที่มีล็อตอยู่แล้ว · รันซ้ำได้ (ล็อตต่อรายการผลิต unique)
 * ค่าเริ่มต้นดูอย่างเดียว (dry run) — ใส่ --apply เพื่อเขียนจริง
 */
const apply = process.argv.includes("--apply");

async function main() {
  await dbConnect();

  const orders = await productionOrderModel
    .find({ production_status: "done", deleted_at: null })
    .select("_id production_no production_date round_id")
    .sort({ production_date: 1 })
    .lean<any[]>();
  const withLots = new Set(
    (await productLotModel.distinct("production_order_id", { production_order_id: { $in: orders.map((o) => o._id) } })).map(String)
  );
  const missing = orders.filter((o) => !withLots.has(String(o._id)));

  console.log(`ใบสั่งผลิตที่ปิดงานแล้ว ${orders.length} ใบ · ยังไม่มีล็อต ${missing.length} ใบ${apply ? "" : " (dry run — ใส่ --apply เพื่อสร้างจริง)"}`);
  for (const o of missing) console.log(`  - ${o.production_no}`);
  if (!apply) return;

  let lots = 0;
  for (const o of missing) {
    await createLotsForProduction(o);
    const r = await productLotModel.updateMany(
      { production_order_id: o._id, qty_remaining: { $ne: null } },
      { $set: { qty_remaining: 0 } }
    );
    const n = await productLotModel.countDocuments({ production_order_id: o._id });
    lots += n;
    console.log(`  ✓ ${o.production_no}: ${n} ล็อต (ตั้งคงเหลือ 0: ${r.modifiedCount})`);
  }
  console.log(`สร้างล็อตย้อนหลังแล้ว ${lots} ล็อต`);
}

main()
  .catch((err) => {
    console.error("\nbackfill ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
