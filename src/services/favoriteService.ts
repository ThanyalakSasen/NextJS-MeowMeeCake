/**
 * favoriteService — รายการโปรดของลูกค้า (ย้ายมาจาก backend ฝั่งลูกค้า favoriteController · customer-backend-merge.md §8.14)
 *
 * เก็บใน Interactions (action_type "wishlist") — แหล่งเดียวกับที่ระบบแนะนำสินค้าใช้ (ฝั่งลูกค้าเขียน collection เดียวกัน)
 * 1 สินค้า = 1 แถวต่อผู้ใช้ · เอาออก = soft delete (deleted_at) · เพิ่มซ้ำ = กู้แถวเดิมกลับ
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound } from "../lib/httpError";
import { isObjectId } from "../lib/objectId";
import interactionModel from "../models/interactionModel";
import productModel from "../models/productModel";
import "../models/productCategoryModel"; // ลงทะเบียน schema ก่อน populate("category_id")

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FavoriteItem {
  id: string;
  name: string;
  nameeg: string;
  category: string;
  /** ราคาขายจริง (ราคาลดถ้ามี) */
  price: number;
  /** ราคาปกติไว้แสดงขีดฆ่า — null ถ้าไม่มีราคาลด */
  originalPrice: number | null;
  image: string;
  /** ยังเปิดขายอยู่ (ไม่ถูกซ่อน) */
  inStock: boolean;
  rating: string;
  is_preorder: boolean;
}

/** รายการโปรดของฉัน (ล่าสุดก่อน) — สินค้าที่ถูกลบไปแล้วไม่แสดง · รูปแบบเดียวกับฝั่งลูกค้า */
export async function listFavorites(userId: string): Promise<{ items: FavoriteItem[] }> {
  await dbConnect();
  const docs = await interactionModel
    .find({ user_id: userId, action_type: "wishlist", deleted_at: null })
    .sort({ created_at: -1 })
    .select("product_id")
    .lean<Array<{ product_id: unknown }>>();
  const products = await productModel
    .find({ _id: { $in: docs.map((d) => d.product_id) }, deleted_at: null })
    .populate("category_id", "product_category_name")
    .lean<any[]>();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const items: FavoriteItem[] = [];
  for (const d of docs) {
    const p = byId.get(String(d.product_id));
    if (!p) continue;
    const onSale = p.sale_price != null && Number(p.sale_price) < Number(p.product_price);
    items.push({
      id: String(p._id),
      name: String(p.product_name_th ?? ""),
      nameeg: String(p.product_name_eng ?? ""),
      category: String(p.category_id?.product_category_name ?? ""),
      price: Number(onSale ? p.sale_price : p.product_price ?? 0),
      originalPrice: onSale ? Number(p.product_price) : null,
      image: (p.product_img as string[] | undefined)?.[0] ?? "",
      inStock: p.is_visible !== false,
      rating: p.avg_rating != null ? String(p.avg_rating) : "-",
      is_preorder: p.is_preorder === true,
    });
  }
  return { items };
}

/** product id จาก body/query — รับทั้ง productId (ฝั่งลูกค้าเดิม) และ product_id */
export function readProductId(source: Record<string, unknown> | null | undefined): string {
  const id = source?.productId ?? source?.product_id;
  if (!isObjectId(id)) throw badRequest("productId ไม่ถูกต้อง");
  return id;
}

/**
 * เพิ่มเข้ารายการโปรด — สินค้าต้องยังมีอยู่
 *   - เคยเอาออกแล้ว = กู้แถวเดิม + ตั้ง created_at ใหม่ ให้ขึ้นบนสุดของรายการ "ล่าสุดก่อน" (frontend Q-BE16)
 *     (ระบบแนะนำสินค้าก็เรียง Interactions ตาม created_at — กดถูกใจใหม่ = สัญญาณล่าสุดเหมือนกัน)
 *   - อยู่ในรายการอยู่แล้ว = ไม่เปลี่ยนลำดับ (กดซ้ำ/คำขอซ้ำ) · ยังไม่เคยมี = สร้างแถวใหม่
 */
export async function addFavorite(userId: string, productId: string) {
  await dbConnect();
  if (!(await productModel.exists({ _id: productId, deleted_at: null }))) throw notFound("ไม่พบสินค้า");
  const now = new Date();
  // created_at ของ timestamps เป็น immutable — ไม่ใส่ overwriteImmutable mongoose จะตัด $set ทิ้งเงียบ ๆ
  const restored = await interactionModel
    .findOneAndUpdate(
      { user_id: userId, product_id: productId, action_type: "wishlist", deleted_at: { $ne: null } },
      { $set: { deleted_at: null, created_at: now } },
      { returnDocument: "after", overwriteImmutable: true }
    )
    .lean();
  if (restored) return restored;
  return interactionModel
    .findOneAndUpdate(
      { user_id: userId, product_id: productId, action_type: "wishlist" },
      { $set: { deleted_at: null } },
      { returnDocument: "after", upsert: true }
    )
    .lean();
}

/** เอาออกจากรายการโปรด (ไม่อยู่ในรายการ = ไม่ error) */
export async function removeFavorite(userId: string, productId: string) {
  await dbConnect();
  await interactionModel.updateOne(
    { user_id: userId, product_id: productId, action_type: "wishlist", deleted_at: null },
    { $set: { deleted_at: new Date() } }
  );
  return { removed: true, product_id: productId };
}
