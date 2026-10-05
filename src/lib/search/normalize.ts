/**
 * lib/search/normalize.ts — ปรับข้อความให้อยู่ในรูปแบบเดียวกันก่อนเทียบ/ค้นหา · ย้ายมาจาก backend ฝั่งลูกค้า (§8.16)
 * ใช้ทั้งฝั่ง query ที่ผู้ใช้พิมพ์ และฝั่งข้อมูลสินค้าที่ทำดัชนี
 * ────────────────────────────────────────────────────────
 * - lowercase (รองรับอังกฤษ)
 * - ตัดวรรณยุกต์/สระบนล่างภาษาไทย (เช่น ่ ้ ๊ ๋ ั ิ ี ึ ื ุ ู ็ ์) ออก
 *   เพื่อให้พิมพ์ผิดวรรณยุกต์/สระเล็กน้อยยังค้นเจอ (เสริม fuzzy matching)
 * - รวมช่องว่างซ้ำ และตัดช่องว่างหัวท้าย
 */

// U+0E31 (MAI HAN-AKAT), U+0E34-0E3A (สระบนล่าง), U+0E47-0E4E (วรรณยุกต์ + ์ ฯลฯ)
const THAI_MARKS_REGEX = /[ัิ-ฺ็-๎]/g;

export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .normalize("NFC")
    .replace(THAI_MARKS_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLoose(input: string | null | undefined): string {
  // เวอร์ชันเข้มกว่า normalizeText — ตัดช่องว่างทั้งหมด ใช้เทียบ substring แบบไม่สนช่องว่าง
  return normalizeText(input).replace(/\s+/g, "");
}
