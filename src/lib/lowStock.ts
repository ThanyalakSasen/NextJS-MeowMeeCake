/**
 * lowStock — เกณฑ์ "สินค้าใกล้หมด" ใช้ร่วมกันทุกที่ (แจ้งเตือน, /api/admin/products/low-stock, dashboard)
 *
 * แต่ละสินค้าตั้งเกณฑ์เองได้ที่ products.low_stock_threshold (เทียบ reorder_point ของวัตถุดิบ)
 * ไม่ตั้ง (null) = ใช้ค่าเริ่มต้น DEFAULT_LOW_STOCK_THRESHOLD — docs/LINE.md §9.5
 */

/** เกณฑ์เริ่มต้นเมื่อสินค้าไม่ได้ตั้ง low_stock_threshold เอง (ค่าเดิมก่อนมีฟิลด์นี้) */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** เกณฑ์ที่ใช้จริงของสินค้าชิ้นนี้ */
export function effectiveLowStockThreshold(product: { low_stock_threshold?: number | null }): number {
  return product.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
}

/** true = สต็อก "เพิ่งข้าม" เกณฑ์ลงมา (before > เกณฑ์ และ after ≤ เกณฑ์) — ใช้กันแจ้งซ้ำตอนต่ำอยู่แล้ว */
export function crossedLowStock(threshold: number, before: number, after: number): boolean {
  return before > threshold && after <= threshold;
}

/** เงื่อนไข MongoDB: สต็อก ≤ เกณฑ์ของแต่ละสินค้า (ใช้ใน find/countDocuments ร่วมกับ filter อื่น) */
export const LOW_STOCK_EXPR = {
  $expr: {
    $lte: ["$product_stock_quantity", { $ifNull: ["$low_stock_threshold", DEFAULT_LOW_STOCK_THRESHOLD] }],
  },
} as const;
