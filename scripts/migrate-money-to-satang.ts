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

/**
 * BACKLOG §3.11 — ย้ายข้อมูลเงินเดิมที่เก็บเป็น "บาท" (float) ให้เป็น "สตางค์" (integer) ครั้งเดียว
 * (คูณ ×100 ทุกฟิลด์) — ใช้ MongoDB `$mul` เป็น atomic operation ต่อ collection ไม่ต้อง fetch มา
 * วนลูปทีละเอกสารใน JS (เร็วกว่า + ไม่มี partial-failure กลางทาง)
 *
 * ครอบคลุม: orderModel, orderItemModel (รวม selected_options[].extra_price), preorderModel,
 * preorderItemModel, paymentModel, promotionUsagesModel — **ไม่รวม** cost_per_unit (orderItem/
 * preorderItem) หรือ field เงินใน productModel/promotionModel/deliveryZoneModel/expenseModel/
 * recipeModel/componentModel/ingredientModel เพราะยังไม่ถูกแปลงในเฟสนี้ (ดู src/lib/money.ts)
 *
 * **กันรันซ้ำ**: บันทึก marker ไว้ใน collection `migrations` หลังรันสำเร็จ — รันซ้ำจะข้ามให้อัตโนมัติ
 * (รันซ้ำโดยไม่มี guard นี้จะคูณ ×100 ซ้ำสอง ทำให้ยอดเงินพังทั้งระบบ)
 */
const MIGRATION_ID = "money_to_satang_3_11";

interface MigrationDoc {
  _id: string;
  applied_at: Date;
  summary: Record<string, number>;
}

async function alreadyApplied(db: mongoose.mongo.Db): Promise<boolean> {
  const doc = await db.collection<MigrationDoc>("migrations").findOne({ _id: MIGRATION_ID });
  return !!doc;
}

async function markApplied(db: mongoose.mongo.Db, summary: Record<string, number>): Promise<void> {
  await db
    .collection<MigrationDoc>("migrations")
    .insertOne({ _id: MIGRATION_ID, applied_at: new Date(), summary });
}

/**
 * รัน migration จริง — แยกออกมาจาก main() ของ CLI เพื่อให้ integration test import ไปเรียกตรง ๆ ได้
 * โดยไม่โดน side effect ของ main() (mongoose.disconnect() ตอนจบ ซึ่งจะไปตัด connection ที่ test อื่น
 * ในไฟล์เดียวกันใช้ร่วมกันอยู่)
 */
export async function runMigration(): Promise<Record<string, number> | null> {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db (dbConnect ไม่สำเร็จ)");

  if (await alreadyApplied(db)) {
    console.log(`migration "${MIGRATION_ID}" เคยรันไปแล้ว — ข้าม (ลบ doc ใน migrations ถ้าตั้งใจรันซ้ำจริง ๆ)`);
    return null;
  }

  const summary: Record<string, number> = {};

  // ── orderModel: subtotal, discount_amount, delivery_fee, total_amount ──
  {
    const res = await orderModel.updateMany(
      {},
      { $mul: { subtotal: 100, discount_amount: 100, delivery_fee: 100, total_amount: 100 } }
    );
    summary.orders = res.modifiedCount;
  }

  // ── orderItemModel: unit_price, total_price, selected_options[].extra_price ──
  // (ไม่รวม cost_per_unit — ยังเป็นบาทเหมือนเดิม)
  {
    const res = await orderItemModel.updateMany(
      {},
      {
        $mul: {
          unit_price: 100,
          total_price: 100,
          "selected_options.$[].extra_price": 100,
        },
      }
    );
    summary.order_items = res.modifiedCount;
  }

  // ── preorderModel: เหมือน orderModel ──
  {
    const res = await preorderModel.updateMany(
      {},
      { $mul: { subtotal: 100, discount_amount: 100, delivery_fee: 100, total_amount: 100 } }
    );
    summary.preorders = res.modifiedCount;
  }

  // ── preorderItemModel: unit_price, total_price (ไม่มี selected_options, ไม่รวม cost_per_unit) ──
  {
    const res = await preorderItemModel.updateMany(
      {},
      { $mul: { unit_price: 100, total_price: 100 } }
    );
    summary.preorder_items = res.modifiedCount;
  }

  // ── paymentModel: amount (ใช้ร่วมทั้ง order/preorder payment) ──
  {
    const res = await paymentModel.updateMany({}, { $mul: { amount: 100 } });
    summary.payments = res.modifiedCount;
  }

  // ── promotionUsagesModel: discount_applied เท่านั้น (promotionModel เองยังเป็นบาท ไม่แตะ) ──
  {
    const res = await promotionUsagesModel.updateMany({}, { $mul: { discount_applied: 100 } });
    summary.promotion_usages = res.modifiedCount;
  }

  await markApplied(db, summary);

  console.log("migrate-money-to-satang เสร็จแล้ว:");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v} เอกสาร`);
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
