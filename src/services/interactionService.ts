/**
 * interactionService — บันทึกพฤติกรรมลูกค้าลง Interactions ให้ระบบแนะนำสินค้าใช้ (recommendationEngine)
 *
 *   trackView(userId, productId)          → ลูกค้าเปิดดูหน้าสินค้า (POST /api/shop/interactions)
 *                                           ดูสินค้าเดิมซ้ำภายใน 30 นาที = ไม่บันทึกเพิ่ม · จำกัด 120 ครั้ง/นาที/ผู้ใช้
 *   recordAddToCart(userId, productId, q) → เรียกจาก cartService.addItem หลังหยิบใส่ตะกร้าสำเร็จ
 *
 * wishlist = favoriteService · purchase = อ่านจาก Orders ใน engine — จึงไม่มีในนี้
 */
import dbConnect from "../lib/dbConnect";
import { notFound } from "../lib/httpError";
import { rateLimit } from "../lib/rateLimit";
import interactionModel from "../models/interactionModel";
import productModel from "../models/productModel";

export const VIEW_DEDUPE_MS = 30 * 60_000;

export async function trackView(userId: string, productId: string): Promise<{ recorded: boolean }> {
  await rateLimit(userId, "shop:interactions", { limit: 120, windowMs: 60_000 });
  await dbConnect();

  const product = await productModel.exists({ _id: productId, deleted_at: null });
  if (!product) throw notFound("ไม่พบสินค้าที่ระบุ");

  // เปิดหน้าเดิมซ้ำ / refresh ไม่ให้ดันน้ำหนัก view จนเกินจริง
  const recent = await interactionModel.exists({
    user_id: userId,
    product_id: productId,
    action_type: "view",
    deleted_at: null,
    created_at: { $gte: new Date(Date.now() - VIEW_DEDUPE_MS) },
  });
  if (recent) return { recorded: false };

  await interactionModel.create({ user_id: userId, product_id: productId, action_type: "view" });
  return { recorded: true };
}

export async function recordAddToCart(userId: string, productId: string, quantity: number): Promise<void> {
  await dbConnect();
  await interactionModel.create({
    user_id: userId,
    product_id: productId,
    action_type: "add_to_cart",
    metadata: { quantity },
  });
}
