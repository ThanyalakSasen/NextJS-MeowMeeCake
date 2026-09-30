import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import dbConnect from "../src/lib/dbConnect";
import { generateProductCode, isPreorderOf } from "../src/lib/productCode";
import productModel from "../src/models/productModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * เติมฟิลด์ product_id (รหัสสินค้า pos-/pre-) ให้สินค้าเดิมที่ยังไม่มี
 * ใช้ created_at ของสินค้านั้นเป็นวัน/ปีในรหัส — รันซ้ำได้ (ข้ามตัวที่มีรหัสแล้ว)
 */
async function main() {
  await dbConnect();

  const missing = await productModel
    .find({ $or: [{ product_id: { $exists: false } }, { product_id: null }, { product_id: "" }] })
    .select("_id is_preorder product_types product_type created_at")
    .lean<any[]>();

  console.log(`พบสินค้าที่ยังไม่มีรหัส: ${missing.length} รายการ`);
  let done = 0;

  for (const p of missing) {
    const at = p.created_at ? new Date(p.created_at) : new Date();
    // สินค้าปกติ = pos- ; พรีออเดอร์ = pre- — อ่านฟิลด์รุ่นเก่า (product_types / product_type) ด้วยถ้ายัง
    // ไม่ได้ migrate (isPreorderOf) ดีฟอลต์สินค้าปกติถ้าตัดสินไม่ได้
    const isPreorder = isPreorderOf(p) ?? false;

    let ok = false;
    for (let attempt = 0; attempt < 30 && !ok; attempt++) {
      try {
        await productModel.updateOne(
          { _id: p._id },
          { $set: { product_id: generateProductCode(isPreorder, at) } }
        );
        ok = true;
      } catch (err: any) {
        if (err?.code === 11000 && attempt < 29) continue; // รหัสสุ่มชน → ลองใหม่
        throw err;
      }
    }
    if (ok) done++;
  }

  console.log(`เติมรหัสสำเร็จ ${done}/${missing.length}`);
  console.log("อย่าลืมรัน productModel.syncIndexes() หรือให้ mongoose สร้าง unique index ใหม่");
}

main()
  .catch((err) => {
    console.error("\nbackfill ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
