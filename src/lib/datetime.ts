/**
 * datetime — ตัวช่วยเรื่องวันเวลาแบบอิงเวลาไทย (Asia/Bangkok, UTC+7)
 * วันที่แบบ string "YYYY-MM-DD" (รอบพรีออเดอร์ · แดชบอร์ด · เตือนลูกค้า)
 */

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** คืนวันที่ตามเวลาไทยในรูปแบบ "YYYY-MM-DD" */
export function bangkokDateString(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}
