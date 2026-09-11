import mongoose from "mongoose";
import userModel from "@/models/userModel";
import productModel from "@/models/productModel";
import ingredientModel from "@/models/ingredientModel";
import unitModel from "@/models/unitModel";

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
