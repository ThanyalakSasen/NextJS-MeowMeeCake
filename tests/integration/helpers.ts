import mongoose from "mongoose";
import userModel from "@/models/userModel";
import productModel from "@/models/productModel";
import ingredientModel from "@/models/ingredientModel";
import unitModel from "@/models/unitModel";
import preorderModel from "@/models/preorderModel";
import recipeModel from "@/models/recipeModel";

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

export async function makeProduct(over: Record<string, unknown> = {}) {
  seq++;
  return productModel.create({
    product_id: `pos-${String(seq).padStart(7, "0")}`,
    product_name_th: `สินค้า ${seq}`,
    product_name_eng: `Product ${seq}`,
    category_id: oid(),
    unit_id: oid(),
    product_price: 100,
    product_type: "inStore",
    product_stock_quantity: 50,
    ...over,
  });
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

export async function makeIngredient(over: Record<string, unknown> = {}) {
  seq++;
  const unit = await makeUnit();
  return ingredientModel.create({
    ingredient_name: `วัตถุดิบ ${seq}-${Date.now()}`,
    ingredient_category_id: oid(),
    unit_id: unit._id,
    current_stock: 0,
    cost_per_unit: 10,
    reorder_point: 5,
    ...over,
  });
}

export async function makeRecipe(productId: string, over: Record<string, unknown> = {}) {
  seq++;
  return recipeModel.create({
    recipe_name: `สูตรทดสอบ ${seq}`,
    product_id: productId,
    yield_qty: 10,
    yield_unit_id: oid(),
    estimated_cost_per_batch: 100,
    created_by: oid(),
    ...over,
  });
}

/** สร้าง preorder ตรง ๆ ผ่าน model (ไม่ผ่าน preorderService — ไม่ต้องมีรอบ/โควตาจริงสำหรับเทส payment) */
export async function makePreorder(userId: string, over: Record<string, unknown> = {}) {
  seq++;
  return preorderModel.create({
    preorder_no: `PRE-TEST-${seq}-${Date.now()}`,
    user_id: userId,
    round_id: oid(),
    order_type: "takeaway",
    subtotal: 100,
    total_amount: 100,
    ...over,
  });
}
