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

/**
 * สิทธิ์ใช้โค้ดต่อลูกค้า — ร้านไม่ตั้ง max_user_per_user (ว่าง/0) = ใช้ได้ "1 ครั้งต่อคน" (ใช้โค้ดซ้ำไม่ได้)
 * ตั้งค่า > 0 = ใช้ได้ตามจำนวนนั้น · บัญชีลูกค้าทั่วไปของ POS ไม่นับสิทธิ์ต่อคน (ใช้ร่วมกันทุกบิล)
 */
export function perUserLimit(v: unknown): number {
  return positiveLimit(v) ?? 1;
}

/** หน้าเว็บ: ใช้โค้ดส่วนลด + คูปองของฉัน รวมกันได้สูงสุดเท่านี้ต่อการสั่งซื้อ 1 ครั้ง */
export const MAX_DISCOUNTS_PER_ORDER = 2;
export const TOO_MANY_DISCOUNTS_MESSAGE = `ใช้โค้ดหรือส่วนลดได้สูงสุด ${MAX_DISCOUNTS_PER_ORDER} รายการต่อการสั่งซื้อ`;

/** รวม promotion_code (ตัวเดียวแบบเดิม) + promotion_codes (หลายตัว) → โค้ดที่ normalize แล้ว ไม่ซ้ำ */
export function discountCodesOf(input: { promotion_code?: string | null; promotion_codes?: readonly string[] | null }): string[] {
  const all = [input.promotion_code ?? null, ...(input.promotion_codes ?? [])].map(normalizePromoCode).filter(Boolean);
  return [...new Set(all)];
}
