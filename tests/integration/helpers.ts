import mongoose from "mongoose";
import userModel from "@/models/userModel";
import productModel from "@/models/productModel";

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
