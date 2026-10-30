/**
 * ค้นเลขออเดอร์/พรีออเดอร์จากหน้าประวัติของลูกค้า — ลูกค้าจำแค่รหัสท้าย (เช่น MMC004 จาก ORD-20261024-MMC004)
 *   ไม่มี "-" ในคำค้น = หาเฉพาะในรหัสท้ายเลขบิล (หลังขีดสุดท้าย) — ตัวเลขอย่าง "004" ไม่ไปตรงกับวันที่ (20261004) ของบิลอื่น
 *   มี "-" (พิมพ์เลขเต็ม/บางส่วนที่ข้ามขีด) = ค้นทั้งเลขตามเดิม
 */
import { escapeRegExp } from "./queryParams";

export function docNoSearchRegExp(search: string): RegExp {
  const q = search.trim();
  const esc = escapeRegExp(q);
  return q.includes("-") ? new RegExp(esc, "i") : new RegExp(`${esc}[^-]*$`, "i");
}
