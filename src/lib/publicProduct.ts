/**
 * publicProduct — สินค้าในรูปที่ส่งให้ API สาธารณะ / ลูกค้าได้ (docs/BACKLOG5.md R1)
 *
 * เลือก field แบบ allow-list — field ใหม่ที่เพิ่มใน productModel จะไม่หลุดออกหน้าร้านเองโดยไม่ตั้งใจ
 * ไม่ส่ง: purchase_cost (ต้นทุน) · low_stock_threshold · yield_per_batch · lead_time/ฟิลด์ภายในอื่น ๆ · สูตร (ปริมาณวัตถุดิบ)
 * หลังร้าน (/api/admin/products*) ยังได้เอกสารเต็มตามเดิม
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PUBLIC_PRODUCT_FIELDS = [
  "_id",
  "product_id", // รหัสสินค้า pos-/pre-
  "product_name_th",
  "product_name_eng",
  "category_id",
  "product_price",
  "sale_price",
  "is_visible",
  "product_img",
  "product_description",
  "preparation_heating",
  "unit_id",
  "is_preorder",
  "preorder_config",
  "product_stock_quantity", // หน้าเว็บใช้ซ่อนสินค้าหมด
  "avg_rating",
  "review_count",
  "created_at",
  "updated_at",
  // ฟิลด์ที่ระบบแนะนำสินค้าเติมให้ (ไม่อยู่ใน schema)
  "category_name",
  "ingredientNames", // ชื่อวัตถุดิบ (ไม่มีปริมาณ) — ใช้เตือนแพ้อาหาร
] as const;

export function toPublicProduct<T extends Record<string, any> | null | undefined>(product: T): Record<string, any> | T {
  if (!product || typeof product !== "object") return product;
  const out: Record<string, any> = {};
  for (const key of PUBLIC_PRODUCT_FIELDS) {
    if (key in product) out[key] = (product as Record<string, any>)[key];
  }
  return out;
}

/** field ที่ให้หน้าร้านเรียงได้ (?sortBy=) — ไม่รวมต้นทุน/field ภายใน (BACKLOG5 Y5) */
export const PUBLIC_PRODUCT_SORTS = ["created_at", "product_name_th", "product_name_eng", "product_price", "avg_rating", "review_count"];
