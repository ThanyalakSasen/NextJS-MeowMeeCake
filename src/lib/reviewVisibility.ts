/**
 * reviewVisibility — เงื่อนไข "รีวิวที่ลูกค้าเห็น" ที่ใช้ร่วมกันทุกที่ (customer-backend-merge.md §8.20 · docs/BACKLOG5.md G4)
 *
 * รีวิวที่แสดง = ยังไม่ถูกลบ + is_visible: true + status ไม่ใช่ hidden/pending
 * (เอกสารเก่าที่ไม่มี status นับเป็น approved — `$nin` จับค่าที่ไม่มี field ด้วย)
 * ต้องดูทั้งสองค่าเพราะหลังร้านฝั่งลูกค้า (พอร์ต 4000) ยังซ่อนรีวิวด้วย status อย่างเดียวได้
 */
export const VISIBLE_REVIEW = { deleted_at: null, is_visible: true, status: { $nin: ["hidden", "pending"] } } as const;

/** เงื่อนไขเดียวกันสำหรับรีวิวที่ถูก $lookup มาไว้ใต้ field อื่น เช่น prefixed("review") → { "review.deleted_at": null, ... } */
export function visibleReviewMatch(prefix: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(VISIBLE_REVIEW).map(([k, v]) => [`${prefix}.${k}`, v]));
}
