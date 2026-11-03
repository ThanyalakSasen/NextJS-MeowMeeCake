/**
 * บัญชี "ลูกค้าทั่วไป" คงที่ — ผูกกับออเดอร์หน้าร้าน (POS) ที่ไม่ระบุตัวลูกค้าจริง
 * สร้างโดย scripts/seed.ts · ไม่มี password (login ไม่ได้ตั้งใจ)
 * POS หา id ผ่าน GET /api/admin/pos/guest-customer (orders.view) — ไม่ต้องใช้สิทธิ์ employees
 */
export const GUEST_CUSTOMER_EMAIL = "guest@meowmeecake.local";

/** user นี้คือบัญชี "ลูกค้าทั่วไป" ของ POS ไหม */
export async function isPosGuestUser(userId: string): Promise<boolean> {
  const { default: userModel } = await import("../models/userModel");
  const user = await userModel.findById(userId).select("email").lean<{ email?: string } | null>();
  return user?.email?.toLowerCase() === GUEST_CUSTOMER_EMAIL.toLowerCase();
}
