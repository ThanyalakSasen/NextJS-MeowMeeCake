import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import dbConnect from "../src/lib/dbConnect";
import productionOrderModel from "../src/models/productionOrderModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * เปลี่ยนเลขใบสั่งผลิตเดิม `PRD-YYYYMMDD-XXXXX` → `PO-YYYYMMDD-XXXXX` (ใบใหม่ขึ้นต้น PO- แล้ว — ผู้ใช้ขอ 2026-10-30)
 * ส่วนอื่นของเลขคงเดิม · ล็อต/รายการอ้างใบด้วย _id ไม่ใช่เลข จึงไม่ต้องแก้ตาม · รันซ้ำได้
 * ค่าเริ่มต้นดูอย่างเดียว (dry run) — ใส่ --apply เพื่อเขียนจริง
 */
const apply = process.argv.includes("--apply");

async function main() {
  await dbConnect();
  const orders = await productionOrderModel
    .find({ production_no: /^PRD-/ })
    .select("_id production_no")
    .lean<any[]>();
  console.log(`ใบสั่งผลิตที่ยังขึ้นต้น PRD-: ${orders.length} ใบ${apply ? "" : " (dry run — ใส่ --apply เพื่อเปลี่ยนจริง)"}`);
  for (const o of orders) {
    const next = String(o.production_no).replace(/^PRD-/, "PO-");
    console.log(`  ${o.production_no} → ${next}`);
    if (apply) await productionOrderModel.updateOne({ _id: o._id }, { $set: { production_no: next } });
  }
}

main()
  .catch((err) => {
    console.error("\nmigrate ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
