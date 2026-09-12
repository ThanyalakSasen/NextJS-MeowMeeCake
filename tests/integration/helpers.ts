import mongoose from "mongoose";
import userModel from "@/models/userModel";
import productModel from "@/models/productModel";
import ingredientModel from "@/models/ingredientModel";
import unitModel from "@/models/unitModel";
import preorderModel from "@/models/preorderModel";
import productVariantModel from "@/models/productVariantModel";
import productOptionModel from "@/models/productOptionModel";
import recipeModel from "@/models/recipeModel";
import addressModel from "@/models/addressModel";
import { toSatang } from "@/lib/money";

export const oid = () => new mongoose.Types.ObjectId();

let seq = 0;

export async function makeUser(over: Record<string, unknown> = {}) {
  seq++;
  return userModel.create({
    user_fullname: `Test User ${seq}`,
    email: `u${seq}.${Date.now()}@test.local`,
    auth_provider: "local",
    role_id: oid(),
    ...over,
  });
}

/**
 * product_price/sale_price ที่ผู้เรียกส่งมา (หรือค่า default 100 ด้านล่าง) ตั้งใจให้เป็น "บาท" เหมือน
 * ทุกเทสที่เขียนไว้ก่อนเฟส 5b (เช่น `makeProduct({ product_price: 120 })` หมายถึง "สินค้าราคา 120
 * บาท") — แปลงเป็นสตางค์ให้เองในนี้ที่เดียว กันต้องไล่แก้ทุกจุดเรียกทั่วทั้ง test suite (51 จุดใน 12
 * ไฟล์ ณ วันที่แก้ - ต่างจาก makeIngredient/makeRecipe ในเฟส 4 ที่ปรับแค่ default ตรง ๆ เพราะตอนนั้น
 * มีจุดเรียกน้อยกว่ามากและเป็นเทสที่เพิ่งเขียนใหม่ทั้งหมด ไม่ใช่เทสเก่าที่มีอยู่ก่อนแล้วจำนวนมาก)
 * **purchase_cost ไม่แปลงในนี้** — เทสที่มีอยู่ก่อนแล้ว (`getUnitCostByProduct.test.ts`,
 * `recipeCostMoney.test.ts`) ส่งค่าดิบเป็นสตางค์ตรง ๆ อยู่แล้วตั้งแต่เฟส 4
 */
export async function makeProduct(over: Record<string, unknown> = {}) {
  seq++;
  const merged: Record<string, unknown> = {
    product_id: `pos-${String(seq).padStart(7, "0")}`,
    product_name_th: `สินค้า ${seq}`,
    product_name_eng: `Product ${seq}`,
    category_id: oid(),
    unit_id: oid(),
    product_price: 100,
    product_type: "inStore",
    product_stock_quantity: 50,
    ...over,
  };
  merged.product_price = toSatang(Number(merged.product_price));
  if (merged.sale_price != null) merged.sale_price = toSatang(Number(merged.sale_price));
  return productModel.create(merged);
}

export async function makeUnit(over: Record<string, unknown> = {}) {
  seq++;
  return unitModel.create({
    unit_name: `หน่วย ${seq}-${Date.now()}`,
    unit_abbr: `u${seq}`,
    unit_type: "Custom",
    usage_context: ["Ingredient"],
    ...over,
  });
}

/** cost_per_unit เป็นสตางค์ (integer) — ค่าเริ่มต้น 1000 = 10.00 บาท (BACKLOG §3.11 เฟส 4) */
export async function makeIngredient(over: Record<string, unknown> = {}) {
  seq++;
  const unit = await makeUnit();
  return ingredientModel.create({
    ingredient_name: `วัตถุดิบ ${seq}-${Date.now()}`,
    ingredient_category_id: oid(),
    unit_id: unit._id,
    current_stock: 0,
    cost_per_unit: 1000,
    reorder_point: 5,
    ...over,
  });
}

/** variant_price รับเป็นบาทแล้วแปลงเป็นสตางค์ให้เอง — เหตุผลเดียวกับ makeProduct() ด้านบน */
export async function makeVariant(productId: string, over: Record<string, unknown> = {}) {
  seq++;
  const merged: Record<string, unknown> = {
    product_id: productId,
    variant_name: `ตัวเลือก ${seq}`,
    variant_price: 0,
    ...over,
  };
  merged.variant_price = toSatang(Number(merged.variant_price));
  return productVariantModel.create(merged);
}

/** extra_price รับเป็นบาทแล้วแปลงเป็นสตางค์ให้เอง — เหตุผลเดียวกับ makeProduct() ด้านบน */
export async function makeOption(productId: string, over: Record<string, unknown> = {}) {
  seq++;
  const merged: Record<string, unknown> = {
    product_id: productId,
    option_name: `เพิ่มเติม ${seq}`,
    extra_price: 0,
    ...over,
  };
  merged.extra_price = toSatang(Number(merged.extra_price));
  return productOptionModel.create(merged);
}

/** estimated_cost_per_batch เป็นสตางค์ (integer) — ค่าเริ่มต้น 10000 = 100.00 บาท (BACKLOG §3.11 เฟส 4) */
export async function makeRecipe(productId: string, over: Record<string, unknown> = {}) {
  seq++;
  return recipeModel.create({
    recipe_name: `สูตรทดสอบ ${seq}`,
    product_id: productId,
    yield_qty: 10,
    yield_unit_id: oid(),
    estimated_cost_per_batch: 10000,
    created_by: oid(),
    ...over,
  });
}

export async function makeAddress(userId: string, over: Record<string, unknown> = {}) {
  seq++;
  return addressModel.create({
    user_id: userId,
    house_no: `${seq}/${seq}`,
    sub_district: `ตำบลทดสอบ ${seq}`,
    district: `อำเภอทดสอบ ${seq}`,
    province: "กรุงเทพมหานคร",
    zip_code: "10100",
    ...over,
  });
}

/** สร้าง preorder ตรง ๆ ผ่าน model (ไม่ผ่าน preorderService — ไม่ต้องมีรอบ/โควตาจริงสำหรับเทส payment) */
/** subtotal/total_amount เป็นสตางค์ (integer) — ค่าเริ่มต้น 10000 = 100 บาท (BACKLOG §3.11) */
export async function makePreorder(userId: string, over: Record<string, unknown> = {}) {
  seq++;
  return preorderModel.create({
    preorder_no: `PRE-TEST-${seq}-${Date.now()}`,
    user_id: userId,
    round_id: oid(),
    order_type: "takeaway",
    subtotal: 10000,
    total_amount: 10000,
    ...over,
  });
}
