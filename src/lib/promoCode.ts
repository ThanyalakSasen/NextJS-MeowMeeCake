/**
 * promoCode — กติกากลางของโค้ดส่วนลด/โควตาโปรโมชัน (ใช้ทั้ง promotionService · couponService · promotionUsageService · discountEngine)
 *
 * - normalizePromoCode: ตัดช่องว่าง "ทุกตำแหน่ง" + ตัวพิมพ์ใหญ่ — ลูกค้าคัดลอกโค้ดจากแจ้งเตือน/LINE มักติดช่องว่างหรือขึ้นบรรทัดมาด้วย
 *   (เดิม trim แค่หัวท้าย "SAVE 10" กับ "SAVE10" เลยเป็นคนละโค้ด) · ร้านตั้งโค้ดก็ผ่านตัวนี้ → เทียบกันได้เสมอ
 * - positiveLimit: เพดาน (usage_limit · max_user_per_user · max_discount_amount · min_quantity) ที่ "มีผล" = ตัวเลข > 0
 *   null / ไม่มี / 0 = ไม่จำกัด — เดิม couponService ถือว่า 0 = ไม่จำกัด แต่ promotionService/recordUsage ถือว่า 0 = เต็มแล้ว
 *   (FrontOffice เขียน 0 ลง DB ตรง ๆ ได้) โปรเดียวกันจึงแลกเป็นคูปองได้แต่กรอกโค้ดไม่ได้ · เพดานส่วนลด 0 = ส่วนลดเป็น 0 เสมอ
 */
export function normalizePromoCode(code: unknown): string {
  return typeof code === "string" ? code.replace(/\s+/g, "").toUpperCase() : "";
}

export function positiveLimit(v: unknown): number | null {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
}

/** ข้อความเมื่อใช้โค้ดผิดช่องทาง — ลูกค้า/พนักงานเห็นตรง ๆ จึงห้ามแสดงค่าภายใน (online/instore) — TC-CUS-67 */
export function channelMismatchMessage(channels: string[]): string {
  if (channels.length === 1 && channels[0] === "instore") return "โค้ดนี้ใช้ได้เฉพาะที่หน้าร้านเท่านั้น";
  if (channels.length === 1 && channels[0] === "online") return "โค้ดนี้ใช้ได้เฉพาะการสั่งซื้อออนไลน์เท่านั้น";
  return "โค้ดนี้ใช้กับช่องทางการสั่งซื้อนี้ไม่ได้";
}

export const channelsOf = (p: { applicable_channels?: string[] | null }): string[] =>
  p.applicable_channels?.length ? p.applicable_channels : ["online", "instore"];
