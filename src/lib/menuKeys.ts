/**
 * menuKeys — รายชื่อ menu_key ของสิทธิ์ (ที่เดียว ใช้ทั้ง model · zod schema · permissionService · authGuard)
 *
 * แยกสิทธิ์ตามหน้าย่อยใน sidebar (2026-10-21) — เดิม 1 key คุมหลายหน้า (เช่น "reports" = รายงานยอดขาย + รีวิว +
 * ค่าใช้จ่าย + สรุปการเงิน) ตอนนี้แต่ละหน้ามี key ของตัวเอง:
 *   - key เดิมที่ตรงกับหน้าเดียวอยู่แล้วใช้ชื่อเดิม (products = หน้าสินค้า · stock = สต็อกสินค้า · promotions = คูปอง ฯลฯ)
 *   - หน้าที่เคยอาศัย key ของหน้าอื่นได้ key ใหม่ (SUBMENU_PARENT) — แถวสิทธิ์เดิมถูกคัดลอกให้ key ใหม่อัตโนมัติ
 *     ครั้งเดียว (permissionService.ensureSubmenuPermissions) ใครเคยเข้าหน้าไหนได้ ยังเข้าได้เหมือนเดิม
 *   - "reports" เหลือไว้ให้แถวเก่าอ่านได้เท่านั้น (LEGACY_MENU_KEYS) — ไม่มี route ไหนตรวจแล้ว · หน้าจัดการสิทธิ์ไม่แสดง
 * ต้องตรงกับ frontend src/constants/menuKeys.ts
 */
export const MENU_KEYS = [
  "dashboard",
  // รายงาน & การเงิน
  "reports_sales",
  "reports_reviews",
  "finance_expenses",
  "finance_summary",
  // สินค้า
  "products",
  "stock",
  "search_synonyms",
  // คำสั่งซื้อ
  "orders",
  "preorder",
  "pos",
  "payments",
  // โปรโมชัน
  "pricing",
  "promotions",
  // การผลิต & วัตถุดิบ
  "production",
  "ingredients",
  "ingredient_stock",
  "ingredient_history",
  "units",
  "recipes",
  // พนักงาน
  "employees",
  "permissions",
  "user_log",
  // หน้าร้านออนไลน์
  "store_design",
  "store_info",
  "shipping",
  // เลิกใช้ — แตกเป็น reports_sales / reports_reviews / finance_expenses / finance_summary
  "reports",
] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

/** key ที่ไม่ใช้ตรวจสิทธิ์แล้ว (เก็บไว้ให้แถวเก่ายัง validate ผ่าน) */
export const LEGACY_MENU_KEYS: readonly MenuKey[] = ["reports"];

/** key ใหม่ → key เดิมที่เคยคุมหน้านั้น (ใช้คัดลอกสิทธิ์ตอนย้ายระบบครั้งแรก) */
export const SUBMENU_PARENT: Partial<Record<MenuKey, MenuKey>> = {
  reports_sales: "reports",
  reports_reviews: "reports",
  finance_expenses: "reports",
  finance_summary: "reports",
  search_synonyms: "products",
  store_design: "products",
  pricing: "products",
  pos: "orders",
  ingredient_stock: "ingredients",
  ingredient_history: "ingredients",
  units: "ingredients",
  permissions: "employees",
  user_log: "employees",
  shipping: "store_info",
};
