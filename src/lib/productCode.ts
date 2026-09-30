/**
 * productCode — สร้าง/ตรวจ รหัสสินค้าที่มนุษย์อ่านได้ (ฟิลด์ product_id ใน productModel)
 *
 *   pos-DDYYzzz  = สินค้าปกติ (มีสต็อก) — `is_preorder: false` · ขายได้ทั้งเว็บ (ORD-) และหน้าร้าน (POS-)
 *   pre-DDYYzzz  = สินค้าพรีออเดอร์ (ไม่มีสต็อก ขายผ่านรอบพรีออเดอร์) — `is_preorder: true`
 *
 *   DD  = วันที่สร้าง 2 หลัก (01-31)
 *   YY  = ปี ค.ศ. 2 หลัก (2026 → "26")   ← ถ้าต้องการ พ.ศ. เปลี่ยนที่บรรทัด yy ด้านล่าง
 *   zzz = เลขสุ่ม 3 หลัก (000-999) กันซ้ำ
 *
 * docs/BACKLOG2.md §14 (แก้ 2026-09-30) — เลิกแยกประเภทสินค้าตามช่องทางขาย (inStore/online) แล้ว
 * ช่องทางดูจาก "ออเดอร์" แทน (ORD- เว็บไซต์ / POS- หน้าร้าน / PRE- พรีออเดอร์ — generateDocNo ด้านล่าง)
 * สินค้าเหลือแค่ 2 แบบ ตัดสินด้วยฟิลด์ boolean `is_preorder` ตัวเดียว
 */

/** สินค้าเป็นพรีออเดอร์ไหม — true เฉพาะ is_preorder === true (ไม่มีฟิลด์/ค่าอื่น = สินค้าปกติ) */
export function isPreorderProduct(product: { is_preorder?: unknown } | null | undefined): boolean {
  return product?.is_preorder === true;
}

/**
 * อ่าน "เป็นพรีออเดอร์ไหม" จากเอกสารดิบใน DB (สคริปต์ที่ query ผ่าน .lean()/native driver) — รองรับข้อมูล
 * ทุกรุ่นก่อน scripts/migrate-is-preorder.ts:
 *   is_preorder (boolean) → ใช้เลย
 *   product_types (array, รุ่น 2026-09-24) → มี "preorder" = true · มี "inStore"/"online" = false
 *   product_type (string, รุ่นแรก รวม "ready" = inStore) → "preorder" = true · "inStore"/"online"/"ready" = false
 * คืน null ถ้าตัดสินไม่ได้เลย — ผู้เรียกเลือกค่าดีฟอลต์เอง
 */
export function isPreorderOf(doc: Record<string, unknown>): boolean | null {
  if (typeof doc.is_preorder === "boolean") return doc.is_preorder;
  if (Array.isArray(doc.product_types) && doc.product_types.length > 0) {
    if (doc.product_types.includes("preorder")) return true;
    if (doc.product_types.some((t) => t === "inStore" || t === "online")) return false;
  }
  if (doc.product_type === "preorder") return true;
  if (doc.product_type === "inStore" || doc.product_type === "online" || doc.product_type === "ready") return false;
  return null;
}

const PATTERN = /^(pos|pre)-\d{7}$/;

/** prefix ที่ถูกต้องของรหัสสินค้า */
export function productCodePrefix(isPreorder: boolean): "pos" | "pre" {
  return isPreorder ? "pre" : "pos";
}

export function generateProductCode(isPreorder: boolean, at: Date = new Date()): string {
  const prefix = productCodePrefix(isPreorder);
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
 * ออเดอร์เว็บไซต์ (`ORD-`), ออเดอร์หน้าร้าน (`POS-`), พรีออเดอร์ (`PRE-`), ใบสั่งผลิต (`PRD-`) — ชนกันได้ (เลขสุ่ม ไม่การันตี unique) ผู้เรียก
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

/**
 * อ่านตัวกรองประเภทสินค้าจาก query string ของ route รายการสินค้า
 *   ?is_preorder=true|false (ใหม่) · ?product_type=preorder|inStore|online (เดิม — ยังรับไว้ให้ frontend เก่า:
 *   preorder = true, inStore/online = false เพราะเลิกแยกช่องทางระดับสินค้าแล้ว) · ไม่ส่ง = undefined (ทั้งหมด)
 */
export function isPreorderFilterFrom(sp: URLSearchParams): boolean | undefined {
  const v = sp.get("is_preorder");
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  const legacy = sp.get("product_type");
  if (legacy === "preorder") return true;
  if (legacy === "inStore" || legacy === "online") return false;
  return undefined;
}
