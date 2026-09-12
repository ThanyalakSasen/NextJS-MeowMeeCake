import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import dbConnect from "../src/lib/dbConnect";
import orderModel from "../src/models/orderModel";
import orderItemModel from "../src/models/orderItemModel";
import preorderModel from "../src/models/preorderModel";
import preorderItemModel from "../src/models/preorderItemModel";
import paymentModel from "../src/models/paymentModel";
import promotionUsagesModel from "../src/models/promotionUsagesModel";
import expenseModel from "../src/models/expenseModel";
import deliveryZoneModel from "../src/models/deliveryZoneModel";

/**
 * BACKLOG §3.11 — ย้ายข้อมูลเงินเดิมที่เก็บเป็น "บาท" (float) ให้เป็น "สตางค์" (integer) ครั้งเดียว
 * ต่อ collection (คูณ ×100) — ใช้ MongoDB `$mul` เป็น atomic operation ไม่ต้อง fetch มาวนลูปทีละเอกสาร
 * ใน JS (เร็วกว่า + ไม่มี partial-failure กลางทาง)
 *
 * ครอบคลุม (เฟส 1): orderModel, orderItemModel (รวม selected_options[].extra_price),
 * preorderModel, preorderItemModel, paymentModel, promotionUsagesModel
 * ครอบคลุม (เฟส 2): expenseModel.amount
 * ครอบคลุม (เฟส 3): deliveryZoneModel.fee
 * **ไม่รวม** cost_per_unit (orderItem/preorderItem) หรือ field เงินใน productModel/promotionModel/
 * deliveryZoneModel/recipeModel/componentModel/ingredientModel เพราะยังไม่ถูกแปลง (ดู
 * docs/hardening-5-money-phase1.md §7 แผนเฟสที่เหลือ)
 *
 * **กันรันซ้ำแบบต่อ collection** (ไม่ใช่ marker เดียวทั้งไฟล์!) — แต่ละ section ด้านล่างมี id ของตัวเอง
 * บันทึกไว้ใน collection `migrations` แยกกัน เพราะไฟล์นี้จะถูกต่อเติมฟิลด์ใหม่เข้ามาเรื่อย ๆ ทุกเฟส
 * (เฟส 2 เพิ่ม expenseModel เข้ามาทีหลังเฟส 1) — ถ้าใช้ marker เดียวทั้งไฟล์ รัน migrate ซ้ำหลัง merge
 * เฟส 2 บน DB ที่เคยรันเฟส 1 ไปแล้วจะ "ข้ามทั้งไฟล์" ทันทีโดยไม่แตะ expenseModel เลย (บั๊กจริงที่เจอ
 * ตอนเขียนเฟส 2 นี้เอง — แก้ก่อน merge)
 */
interface MigrationDoc {
  _id: string;
  applied_at: Date;
  modified_count: number;
}

/** รัน $mul update 1 collection แบบกันรันซ้ำ (skip ถ้าเคยรัน sectionId นี้สำเร็จแล้ว) */
async function runSection(
  db: mongoose.mongo.Db,
  sectionId: string,
  run: () => Promise<number>
): Promise<number | null> {
  const marker = db.collection<MigrationDoc>("migrations");
  if (await marker.findOne({ _id: sectionId })) {
    console.log(`  [ข้าม] "${sectionId}" เคยรันไปแล้ว`);
    return null;
  }
  const modifiedCount = await run();
  await marker.insertOne({ _id: sectionId, applied_at: new Date(), modified_count: modifiedCount });
  console.log(`  [เสร็จ] "${sectionId}": ${modifiedCount} เอกสาร`);
  return modifiedCount;
}

/**
 * รัน migration จริง — แยกออกมาจาก main() ของ CLI เพื่อให้ integration test import ไปเรียกตรง ๆ ได้
 * โดยไม่โดน side effect ของ main() (mongoose.disconnect() ตอนจบ ซึ่งจะไปตัด connection ที่ test อื่น
 * ในไฟล์เดียวกันใช้ร่วมกันอยู่)
 */
export async function runMigration(): Promise<Record<string, number | null>> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");

  const summary: Record<string, number | null> = {};

  // ── เฟส 1 ──────────────────────────────────────────────────
  summary.orders = await runSection(db, "money_to_satang_3_11_orders", async () => {
    const res = await orderModel.updateMany(
      {},
      { $mul: { subtotal: 100, discount_amount: 100, delivery_fee: 100, total_amount: 100 } }
    );
    return res.modifiedCount;
  });

  // ไม่รวม cost_per_unit — ยังเป็นบาทเหมือนเดิม (ดูหัวไฟล์)
  summary.order_items = await runSection(db, "money_to_satang_3_11_order_items", async () => {
    const res = await orderItemModel.updateMany(
      {},
      { $mul: { unit_price: 100, total_price: 100, "selected_options.$[].extra_price": 100 } }
    );
    return res.modifiedCount;
  });

  summary.preorders = await runSection(db, "money_to_satang_3_11_preorders", async () => {
    const res = await preorderModel.updateMany(
      {},
      { $mul: { subtotal: 100, discount_amount: 100, delivery_fee: 100, total_amount: 100 } }
    );
    return res.modifiedCount;
  });

  // ไม่มี selected_options, ไม่รวม cost_per_unit
  summary.preorder_items = await runSection(db, "money_to_satang_3_11_preorder_items", async () => {
    const res = await preorderItemModel.updateMany({}, { $mul: { unit_price: 100, total_price: 100 } });
    return res.modifiedCount;
  });

  // ใช้ร่วมทั้ง order/preorder payment
  summary.payments = await runSection(db, "money_to_satang_3_11_payments", async () => {
    const res = await paymentModel.updateMany({}, { $mul: { amount: 100 } });
    return res.modifiedCount;
  });

  // promotionModel เองยังเป็นบาท ไม่แตะ
  summary.promotion_usages = await runSection(
    db,
    "money_to_satang_3_11_promotion_usages",
    async () => {
      const res = await promotionUsagesModel.updateMany({}, { $mul: { discount_applied: 100 } });
      return res.modifiedCount;
    }
  );

  // ── เฟส 2 ──────────────────────────────────────────────────
  summary.expenses = await runSection(db, "money_to_satang_3_11_expenses", async () => {
    const res = await expenseModel.updateMany({}, { $mul: { amount: 100 } });
    return res.modifiedCount;
  });

  // ── เฟส 3 ──────────────────────────────────────────────────
  summary.delivery_zones = await runSection(db, "money_to_satang_3_11_delivery_zones", async () => {
    const res = await deliveryZoneModel.updateMany({}, { $mul: { fee: 100 } });
    return res.modifiedCount;
  });

  console.log("migrate-money-to-satang จบแล้ว:");
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k}: ${v === null ? "ข้าม (เคยรันแล้ว)" : `${v} เอกสาร`}`);
  }
  return summary;
}

// รันจริงเฉพาะตอนเรียกไฟล์นี้ตรง ๆ ผ่าน CLI (`npm run migrate:money-to-satang`) — ไม่รันตอนถูก
// import ไปใช้จากที่อื่น (เช่น integration test ที่ import runMigration() ไปเรียกเอง)
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runMigration()
    .catch((err) => {
      console.error("\nmigrate-money-to-satang ล้มเหลว:", err);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
