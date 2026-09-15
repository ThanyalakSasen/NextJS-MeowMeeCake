/**
 * productCode — สร้าง/ตรวจ รหัสสินค้าที่มนุษย์อ่านได้ (ฟิลด์ product_id ใน productModel)
 *
 *   pos-DDYYzzz  = สินค้าหน้าร้าน / ออนไลน์ (product_type = "inStore" หรือ "online")
 *   pre-DDYYzzz  = สินค้าพรีออเดอร์ (product_type = "preorder")
 *
 *   DD  = วันที่สร้าง 2 หลัก (01-31)
 *   YY  = ปี ค.ศ. 2 หลัก (2026 → "26")   ← ถ้าต้องการ พ.ศ. เปลี่ยนที่บรรทัด yy ด้านล่าง
 *   zzz = เลขสุ่ม 3 หลัก (000-999) กันซ้ำ
 */

export const PRODUCT_TYPES = ["inStore", "online", "preorder"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** ประเภทที่มีสต็อก (product_stock_quantity ใช้งาน) — ทุกอย่างยกเว้น preorder */
export const STOCK_PRODUCT_TYPES = ["inStore", "online"] as const;

export function isStockProductType(t: unknown): boolean {
  return t === "inStore" || t === "online";
}

const PATTERN = /^(pos|pre)-\d{7}$/;

export function generateProductCode(type: ProductType, at: Date = new Date()): string {
  const prefix = type === "preorder" ? "pre" : "pos";
  const dd = String(at.getDate()).padStart(2, "0");
  const yy = String(at.getFullYear() % 100).padStart(2, "0");
  const zzz = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `${prefix}-${dd}${yy}${zzz}`;
}

export function isProductCode(value: unknown): value is string {
  return typeof value === "string" && PATTERN.test(value.trim());
}

/**
 * generateDocNo — เลขที่เอกสารรูปแบบ `<prefix>-YYYYMMDD-<random>` (ตัวพิมพ์ใหญ่, base36) ใช้ร่วมกันโดย
 * ออเดอร์ (`OP-`), พรีออเดอร์ (`PRE-`), ใบสั่งผลิต (`PRD-`) — ชนกันได้ (เลขสุ่ม ไม่การันตี unique) ผู้เรียก
 * ต้องมี retry-on-duplicate-key ของตัวเองเสมอ (ดู `orderService`/`preorderService`/`productionOrderService`)
 */
export function generateDocNo(prefix: string, randomLength = 6, now: Date = new Date()): string {
  const ymd =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const rand = Math.random()
    .toString(36)
    .slice(2, 2 + randomLength)
    .toUpperCase();
  return `${prefix}-${ymd}-${rand}`;
}
