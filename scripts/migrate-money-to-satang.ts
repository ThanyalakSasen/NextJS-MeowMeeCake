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
import ingredientModel from "../src/models/ingredientModel";
import componentModel from "../src/models/componentModel";
import recipeModel from "../src/models/recipeModel";
import productModel from "../src/models/productModel";
import promotionModel from "../src/models/promotionModel";

/**
 * BACKLOG §3.11 — ย้ายข้อมูลเงินเดิมที่เก็บเป็น "บาท" (float) ให้เป็น "สตางค์" (integer) ครั้งเดียว
 * ต่อ collection (คูณ ×100) — ใช้ MongoDB `$mul` เป็น atomic operation ไม่ต้อง fetch มาวนลูปทีละเอกสาร
 * ใน JS (เร็วกว่า + ไม่มี partial-failure กลางทาง)
 *
 * ครอบคลุม (เฟส 1): orderModel, orderItemModel (รวม selected_options[].extra_price),
 * preorderModel, preorderItemModel, paymentModel, promotionUsagesModel
 * ครอบคลุม (เฟส 2): expenseModel.amount
 * ครอบคลุม (เฟส 3): deliveryZoneModel.fee
 * ครอบคลุม (เฟส 4): ingredientModel.cost_per_unit, componentModel.estimated_cost_per_batch,
 * recipeModel.estimated_cost_per_batch, productModel.purchase_cost (**ไม่รวม** product_price/
 * sale_price — ยังไม่แปลง), orderItemModel.cost_per_unit, preorderItemModel.cost_per_unit
 * (ค้างจากเฟส 1 — ต้องรอ recipeModel/ingredientModel/componentModel แปลงก่อนถึงจะแปลงตามได้)
 * ครอบคลุม (เฟส 5a): promotionModel.min_order_amount/max_discount_amount (เสมอ) และ
 * discount_value **เฉพาะตอน discount_type === "Amount"** (ตอน Percentage เป็นตัวเลข % ไม่แปลง) —
 * ใช้ pipeline-style update (`updateMany(filter, [stage, ...])`) แทน `$mul` ธรรมดา เพราะต้อง
 * conditional ตาม field อื่นในเอกสารเดียวกัน (ดูรายละเอียดที่ runSection ด้านล่าง)
 * **ไม่รวม** field เงินใน productModel (product_price/sale_price)/productVariantModel/
 * productOptionModel/cartItemModel/preorderRoundItemModel.price_override เพราะยังไม่ถูกแปลง (ดู
 * docs/hardening-5-money-phase1.md §7 แผนเฟสที่เหลือ)
 *
 * **กันรันซ้ำแบบต่อ collection** (ไม่ใช่ marker เดียวทั้งไฟล์!) — แต่ละ section ด้านล่างมี id ของตัวเอง
 * บันทึกไว้ใน collection `migrations` แยกกัน เพราะไฟล์นี้จะถูกต่อเติมฟิลด์ใหม่เข้ามาเรื่อย ๆ ทุกเฟส
 * (เฟส 2 เพิ่ม expenseModel เข้ามาทีหลังเฟส 1) — ถ้าใช้ marker เดียวทั้งไฟล์ รัน migrate ซ้ำหลัง merge
 * เฟส 2 บน DB ที่เคยรันเฟส 1 ไปแล้วจะ "ข้ามทั้งไฟล์" ทันทีโดยไม่แตะ expenseModel เลย (บั๊กจริงที่เจอ
 * ตอนเขียนเฟส 2 นี้เอง — แก้ก่อน merge) — **บั๊กเดิมเจออีกครั้งตอนเขียนเฟส 4**: orderItem/
 * preorderItem.cost_per_unit เป็น field ที่มีอยู่แล้วตั้งแต่เฟส 1 แต่จงใจไม่รวมใน $mul ตอนนั้น ถ้าใส่
 * cost_per_unit เพิ่มเข้าไปใน $mul ของ section "order_items"/"preorder_items" เดิมตรง ๆ, DB ที่เคยรัน
 * เฟส 1 ไปแล้ว (marker มีอยู่แล้ว) จะข้าม section นั้นทั้งหมดทันที ไม่แตะ cost_per_unit เลย จึงต้องแยก
 * เป็น section ใหม่ "order_items_cost_per_unit"/"preorder_items_cost_per_unit" เสมอเมื่อเพิ่ม field
 * เงินเข้าไปใน collection ที่เคยมี section ของตัวเองอยู่ก่อนแล้ว
 *
 * **กันพังตอน $mul เจอ field ที่เป็น null**: cost_per_unit (orderItem/preorderItem) กับ
 * productModel.purchase_cost เป็น nullable (default: null) — MongoDB `$mul` ทำงานกับ field ที่เป็น
 * null ไม่ได้ (error, ไม่ใช่แค่ข้ามเฉย ๆ) ต้อง filter query ด้วย `{ field: { $type: "number" } }` ก่อน
 * เสมอสำหรับ field เงินที่ nullable (field required อื่น ๆ ในไฟล์นี้ไม่ต้องกรองเพราะไม่มีทาง null)
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

  // ── เฟส 4 ──────────────────────────────────────────────────
  // cost_per_unit/estimated_cost_per_batch เป็น required + มี default (ไม่มีทาง null) → $mul ตรง ๆ
  // ได้เลยทั้ง collection ไม่ต้องกรอง
  summary.ingredients = await runSection(db, "money_to_satang_3_11_ingredients", async () => {
    const res = await ingredientModel.updateMany({}, { $mul: { cost_per_unit: 100 } });
    return res.modifiedCount;
  });

  summary.components = await runSection(db, "money_to_satang_3_11_components", async () => {
    const res = await componentModel.updateMany({}, { $mul: { estimated_cost_per_batch: 100 } });
    return res.modifiedCount;
  });

  summary.recipes = await runSection(db, "money_to_satang_3_11_recipes", async () => {
    const res = await recipeModel.updateMany({}, { $mul: { estimated_cost_per_batch: 100 } });
    return res.modifiedCount;
  });

  // productModel.purchase_cost เป็น nullable (default: null, สินค้าส่วนใหญ่ไม่มีค่านี้เลยถ้าไม่ใช่
  // "ซื้อมาขายต่อ") — MongoDB `$mul` ล้มเหลวถ้าเจอ field ที่เป็น null ตรง ๆ (ไม่ใช่ non-numeric type ปกติ)
  // ต้อง filter เอาเฉพาะเอกสารที่ purchase_cost เป็นตัวเลขจริงก่อน ไม่งั้น updateMany ทั้ง collection จะ
  // พังกลางทาง (ต่างจาก field required ด้านบนที่ไม่มีค่า null ให้ต้องกังวล)
  summary.products_purchase_cost = await runSection(
    db,
    "money_to_satang_3_11_products_purchase_cost",
    async () => {
      const res = await productModel.updateMany(
        { purchase_cost: { $type: "number" } },
        { $mul: { purchase_cost: 100 } }
      );
      return res.modifiedCount;
    }
  );

  // orderItem/preorderItem.cost_per_unit เป็น nullable เหมือนกัน (default: null, ค้างมาตั้งแต่เฟส 1
  // ที่ตั้งใจไม่แปลง) — ใช้ section id ใหม่แยกจาก "order_items"/"preorder_items" เดิมโดยเจตนา ถ้าใช้
  // marker เดิมร่วมกัน DB ที่เคยรันเฟส 1 ไปแล้ว (marker "order_items"/"preorder_items" มีอยู่แล้ว) จะ
  // ข้ามทั้ง section ทันทีโดยไม่แตะ cost_per_unit เลย — เป็นบั๊กแบบเดียวกับที่เจอตอนเฟส 2 เป๊ะ
  // (ดู docs/hardening-5-money-phase1.md §4) จึงต้องแยก marker ให้ section ที่เพิ่ม field ทีหลังเสมอ
  summary.order_items_cost_per_unit = await runSection(
    db,
    "money_to_satang_3_11_order_items_cost_per_unit",
    async () => {
      const res = await orderItemModel.updateMany(
        { cost_per_unit: { $type: "number" } },
        { $mul: { cost_per_unit: 100 } }
      );
      return res.modifiedCount;
    }
  );

  summary.preorder_items_cost_per_unit = await runSection(
    db,
    "money_to_satang_3_11_preorder_items_cost_per_unit",
    async () => {
      const res = await preorderItemModel.updateMany(
        { cost_per_unit: { $type: "number" } },
        { $mul: { cost_per_unit: 100 } }
      );
      return res.modifiedCount;
    }
  );

  // ── เฟส 5a ─────────────────────────────────────────────────
  // ใช้ pipeline-style update (`updateMany(filter, [stage])` — array แทน object เป็น arg ที่ 2) แทน
  // `$mul` ธรรมดา เพราะ discount_value ต้องคูณ ×100 "เฉพาะ" เอกสารที่ discount_type === "Amount"
  // เท่านั้น ($cond ทำแบบนี้ไม่ได้กับ $mul) — bonus ที่ไม่ได้ตั้งใจตอนแรก: $multiply ใน aggregation
  // pipeline คืน null เฉย ๆ เมื่อเจอ operand เป็น null (ไม่ throw เหมือน $mul update operator ธรรมดา
  // ในเฟส 4) ยืนยันด้วยการทดสอบจริง จึงไม่ต้อง filter `$type:"number"` ก่อนเหมือนเฟส 4 เลยสำหรับ
  // min_order_amount/max_discount_amount ที่เป็น nullable เช่นกัน — ปลอดภัยกว่าและโค้ดสั้นกว่า
  summary.promotions = await runSection(db, "money_to_satang_3_11_promotions", async () => {
    // mongoose ปฏิเสธ array (pipeline update) เว้นแต่บอกชัดเจนด้วย { updatePipeline: true } — ต่างจาก
    // native MongoDB driver ที่รับ array ตรง ๆ (ยืนยันตอนทดสอบ syntax นี้ครั้งแรกกับ native driver
    // ก่อนพอร์ตมาใช้ mongoose ที่นี่ ถึงเจอว่าต้องมี option เพิ่ม)
    const res = await promotionModel.updateMany(
      {},
      [
        {
          $set: {
            discount_value: {
              $cond: [
                { $eq: ["$discount_type", "Amount"] },
                { $multiply: ["$discount_value", 100] },
                "$discount_value",
              ],
            },
            min_order_amount: { $multiply: ["$min_order_amount", 100] },
            max_discount_amount: { $multiply: ["$max_discount_amount", 100] },
          },
        },
      ],
      { updatePipeline: true }
    );
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
