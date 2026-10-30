/**
 * datetime — ตัวช่วยเรื่องวันเวลาแบบอิงเวลาไทย (Asia/Bangkok, UTC+7)
 * วันที่แบบ string "YYYY-MM-DD" (รอบพรีออเดอร์ · แดชบอร์ด · เตือนลูกค้า)
 */
import { badRequest } from "./httpError";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** คืนวันที่ตามเวลาไทยในรูปแบบ "YYYY-MM-DD" */
export function bangkokDateString(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** date_from/date_to จาก query — แปลงไม่ได้ = 400 (เดิม Invalid Date หลุดไปถึง MongoDB → 500) */
export function rangeDate(v: string | undefined, name: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${name} ไม่ใช่วันที่ที่ถูกต้อง`);
  return d;
}
