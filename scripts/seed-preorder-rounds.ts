import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import dbConnect from "../src/lib/dbConnect";
import { generateProductCode } from "../src/lib/productCode";
import userModel from "../src/models/userModel";
import unitModel from "../src/models/unitModel";
import productCategoryModel from "../src/models/productCategoryModel";
import productModel from "../src/models/productModel";
import preorderRoundModel from "../src/models/preorderRoundModel";
import preorderRoundItemModel from "../src/models/preorderRoundItemModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * seed-preorder-rounds.ts — สร้างรอบพรีออเดอร์ตัวอย่างสำหรับให้ฝั่งลูกค้าเทสการสั่งสินค้าพรีออเดอร์
 *
 * สร้าง 4 รอบ ทุกรอบเป็นสินค้า "ซาวโดว์" ชุดเดียวกัน (5 รายการ) :
 *   1) 21-27 ส.ค. 2569  → round_status "closed"     (รอบที่ผ่านมาแล้ว, ใส่ current_qty จำลอง)
 *   2) 1-7 ก.ย. 2569     → round_status "open"       (รอบปัจจุบัน — อยู่ในช่วงเปิดรับ ณ ต้น ก.ย.)
 *   3) 14-21 ก.ย. 2569   → round_status "scheduled"  (รอบถัดไป — ตั้งเวลาไว้ ยังไม่เปิด)
 *   4) 1-7 ต.ค. 2569     → round_status "scheduled"  (รอบถัดไป — ตั้งเวลาไว้ ยังไม่เปิด)
 *
 * หมายเหตุ
 *   - round_status: scheduled → open → closed ; scheduled|open → cancelled
 *     ลูกค้าสั่งได้เฉพาะรอบสถานะ "open" ที่ now อยู่ในช่วง open_date..close_date
 *   - วันที่สร้างด้วย new Date(ปี, เดือน-1, วัน, ชม.) = เวลาท้องถิ่นของเครื่องที่รันสคริปต์
 *   - pickup_date = close_date + 6 วัน เวลา 10:00 (ปรับได้ที่ ROUNDS ด้านล่าง)
 *   - idempotent: รันซ้ำได้ ข้ามรอบ/รายการ/สินค้าที่มีอยู่แล้ว
 *   - ต้องรัน `npm run seed` ก่อน (ต้องมี owner user, หมวด "ซาวโดว์", หน่วย "ชิ้น")
 *   - สคริปต์นี้ไม่สร้างเอกสาร Preorders (ออเดอร์ของลูกค้า) — สร้างแค่รอบ + รายการในรอบ
 */

const OWNER_EMAIL = "thanyalak.sas@kkumail.com";
const CATEGORY_NAME = "ซาวโดว์";
const UNIT_NAME = "ชิ้น";

/** new Date เวลาท้องถิ่น (เดือนเป็นเลข 1-12) */
const at = (y: number, m: number, d: number, hh = 0, mm = 0) =>
  new Date(y, m - 1, d, hh, mm, 0, 0);

/** สินค้าซาวโดว์ตัวอย่าง (product_type = "preorder") — idempotent by product_name_th */
const SOURDOUGH_PRODUCTS: Array<{
  product_name_th: string;
  product_name_eng: string;
  product_price: number;
}> = [
  { product_name_th: "ขนมปังซาวร์โดว์ ออริจินอล", product_name_eng: "Original Sourdough Loaf", product_price: 120 },
  { product_name_th: "ซาวร์โดว์ชาร์โคล", product_name_eng: "Charcoal Sourdough", product_price: 140 },
  { product_name_th: "ซาวร์โดว์โฮลวีต", product_name_eng: "Whole Wheat Sourdough", product_price: 130 },
  { product_name_th: "ซาวร์โดว์แครนเบอร์รีวอลนัท", product_name_eng: "Cranberry Walnut Sourdough", product_price: 165 },
  { product_name_th: "ซาวร์โดว์ชีส", product_name_eng: "Cheese Sourdough", product_price: 150 },
];

const ROUNDS: Array<{
  round_name: string;
  open_date: Date;
  close_date: Date;
  pickup_date: Date;
  round_status: "scheduled" | "open" | "closed" | "cancelled";
  simulate_orders: boolean;
}> = [
  {
    round_name: "รอบซาวร์โดว์ • 21-27 ส.ค. 2569",
    open_date: at(2026, 8, 21, 0, 0),
    close_date: at(2026, 8, 27, 23, 59),
    pickup_date: at(2026, 9, 2, 10, 0),
    round_status: "closed",
    simulate_orders: true,
  },
  {
    round_name: "รอบซาวร์โดว์ • 1-7 ก.ย. 2569 (รอบปัจจุบัน)",
    open_date: at(2026, 9, 1, 0, 0),
    close_date: at(2026, 9, 7, 23, 59),
    pickup_date: at(2026, 9, 13, 10, 0),
    round_status: "open",
    simulate_orders: false,
  },
  {
    round_name: "รอบซาวร์โดว์ • 14-21 ก.ย. 2569 (รอบถัดไป)",
    open_date: at(2026, 9, 14, 0, 0),
    close_date: at(2026, 9, 21, 23, 59),
    pickup_date: at(2026, 9, 27, 10, 0),
    round_status: "scheduled",
    simulate_orders: false,
  },
  {
    round_name: "รอบซาวร์โดว์ • 1-7 ต.ค. 2569 (รอบถัดไป)",
    open_date: at(2026, 10, 1, 0, 0),
    close_date: at(2026, 10, 7, 23, 59),
    pickup_date: at(2026, 10, 13, 10, 0),
    round_status: "scheduled",
    simulate_orders: false,
  },
];

const MAX_QTY_TOTAL = 50; // เพดานจำนวนต่อสินค้าต่อรอบ
const MIN_ORDER_QTY = 1;

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/** สร้างสินค้าถ้ายังไม่มี (retry เมื่อ product_id สุ่มชน) แล้วคืน _id */
async function ensureProduct(
  base: (typeof SOURDOUGH_PRODUCTS)[number],
  categoryId: any,
  unitId: any
): Promise<{ id: any; created: boolean }> {
  const existing: any = await productModel
    .findOne({ product_name_th: base.product_name_th, deleted_at: null })
    .select("_id")
    .lean();
  if (existing) return { id: existing._id, created: false };

  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const doc: any = await productModel.create({
        product_id: generateProductCode("preorder"),
        product_name_th: base.product_name_th,
        product_name_eng: base.product_name_eng,
        category_id: categoryId,
        unit_id: unitId,
        product_price: base.product_price,
        sale_price: null,
        is_visible: true,
        product_type: "preorder",
        product_stock_quantity: null,
        preorder_config: { min_order_qty: 1, max_order_qty: 10, lead_time_days: 5 },
        product_description: `${base.product_name_eng} — สั่งล่วงหน้าเป็นรอบ อบสดใหม่ก่อนวันรับ`,
      });
      return { id: doc._id, created: true };
    } catch (err: any) {
      if (err?.code === 11000 && attempt < 29) continue; // product_id ชน → สุ่มใหม่
      throw err;
    }
  }
  throw new Error(`สร้างสินค้าไม่สำเร็จ: ${base.product_name_th}`);
}

async function main() {
  await dbConnect();
  console.log("เชื่อมต่อ MongoDB สำเร็จ — เริ่ม seed รอบพรีออเดอร์\n");

  const owner: any = await userModel.findOne({ email: OWNER_EMAIL.toLowerCase() }).select("_id").lean();
  if (!owner) throw new Error(`ไม่พบ owner user (${OWNER_EMAIL}) — รัน "npm run seed" ก่อน`);

  const category: any = await productCategoryModel
    .findOne({ product_category_name: CATEGORY_NAME })
    .select("_id")
    .lean();
  if (!category) throw new Error(`ไม่พบหมวดหมู่ "${CATEGORY_NAME}" — รัน "npm run seed" ก่อน`);

  const unit: any = await unitModel.findOne({ unit_name: UNIT_NAME }).select("_id").lean();
  if (!unit) throw new Error(`ไม่พบหน่วย "${UNIT_NAME}" — รัน "npm run seed" ก่อน`);

  // 1) สินค้าซาวโดว์
  const productIds: any[] = [];
  let newProducts = 0;
  for (const base of SOURDOUGH_PRODUCTS) {
    const { id, created } = await ensureProduct(base, category._id, unit._id);
    productIds.push(id);
    if (created) newProducts++;
  }
  console.log(`  สินค้าซาวโดว์ (preorder)   +${newProducts} ใหม่ / ${SOURDOUGH_PRODUCTS.length} ทั้งหมด`);

  // 2) รอบ + รายการในรอบ
  for (const r of ROUNDS) {
    let round: any = await preorderRoundModel.findOne({ round_name: r.round_name }).lean();
    let roundCreated = false;
    if (!round) {
      round = await preorderRoundModel.create({
        created_by: owner._id,
        round_name: r.round_name,
        open_date: r.open_date,
        close_date: r.close_date,
        pickup_date: r.pickup_date,
        round_status: r.round_status,
      });
      roundCreated = true;
    }

    let newItems = 0;
    for (const pid of productIds) {
      const exists = await preorderRoundItemModel.exists({ round_id: round._id, product_id: pid });
      if (exists) continue;
      await preorderRoundItemModel.create({
        round_id: round._id,
        product_id: pid,
        price_override: null,
        min_order_qty: MIN_ORDER_QTY,
        max_qty_total: MAX_QTY_TOTAL,
        current_qty: r.simulate_orders ? randInt(15, 40) : 0,
        is_active: true,
      });
      newItems++;
    }

    console.log(
      `  ${(roundCreated ? "[สร้าง] " : "[มีอยู่] ") + r.round_name}`.padEnd(48) +
        ` status=${r.round_status}  +${newItems} รายการใหม่`
    );
  }

  console.log("\nseed รอบพรีออเดอร์เสร็จสมบูรณ์");
}

main()
  .catch((err) => {
    console.error("\nseed รอบพรีออเดอร์ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
