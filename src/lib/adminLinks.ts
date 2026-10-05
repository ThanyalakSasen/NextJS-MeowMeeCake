/**
 * adminLinks — path หน้าเว็บหลังร้าน (frontend) สำหรับ `link` ของแจ้งเตือน (เว็บ + ลิงก์ 🔗 ใน LINE — docs/LINE.md §9.12)
 *
 * path ยืนยันจาก frontend PR #16 (2026-10-03): หน้าออเดอร์ / พรีออเดอร์ / ใบผลิต รองรับ `?id=` เปิด drawer รายละเอียดตรง ๆ
 * (ถ้ายังไม่ล็อกอิน `?next=` พากลับมาหลังล็อกอิน) · เปลี่ยน path ฝั่ง frontend ให้แก้ที่ไฟล์นี้ที่เดียว
 */
const id = (v: unknown) => encodeURIComponent(String(v));

export const adminLinks = {
  order: (orderId: unknown) => `/owner/orders/manageOrders?id=${id(orderId)}`,
  preorder: (preorderId: unknown) => `/owner/orders/preOrderRound?tab=orders&id=${id(preorderId)}`,
  preorderRounds: "/owner/orders/preOrderRound",
  production: (productionOrderId: unknown) => `/owner/production?id=${id(productionOrderId)}`,
  product: (productId: unknown) => `/owner/products/${id(productId)}/edit`,
  products: "/owner/products",
  ingredients: "/owner/ingredients",
  dashboard: "/owner/dashboard",
} as const;
