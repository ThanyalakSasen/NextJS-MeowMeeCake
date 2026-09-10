/**
 * datetime — ตัวช่วยเรื่องวันเวลาแบบอิงเวลาไทย (Asia/Bangkok, UTC+7)
 * ใช้กับ attendance ที่เก็บ work_date เป็น string "YYYY-MM-DD"
 */

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** คืนวันที่ตามเวลาไทยในรูปแบบ "YYYY-MM-DD" */
export function bangkokDateString(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** ตรวจว่าเป็นรูปแบบ "YYYY-MM-DD" ที่ valid หรือไม่ */
export function isWorkDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t);
}
