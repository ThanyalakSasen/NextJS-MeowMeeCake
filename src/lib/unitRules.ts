/**
 * unitRules — หน่วยที่ต้องเป็นจำนวนเต็ม (ฟอง / ชิ้น / กล่อง ...) · กติกาเดียวกับหน้าเว็บ
 * (frontend src/constants/ingredientCategoryUnits.ts isIntegerOnlyUnit — แก้ที่หนึ่งต้องแก้อีกที่)
 */

const INTEGER_UNIT_TYPES = new Set(["ProductCount", "Package", "Sheet", "Tray", "Slice", "Piece"]);
const DECIMAL_UNIT_TYPES = new Set(["IngredientWeight", "IngredientVolume", "ProductWeight", "ProductVolume"]);
const INTEGER_UNIT_NAME_PATTERN = /ฟอง|ชิ้น|กล่อง|ถาด|แผ่น|ลูก|ผล|ถุง|ซอง|ขวด|กระป๋อง|แพ็ก|แพ็ค|ห่อ|ม้วน|ใบ|อัน|หลอด|ก้อน|ชุด|ลัง/i;
const DECIMAL_UNIT_NAME_PATTERN = /^(กรัม|ก\.?|g|กิโลกรัม|กก\.?|kg|มิลลิลิตร|มล\.?|ml|ลิตร|ล\.?|l|ปอนด์|lb|ออนซ์|oz)$/i;

export function isIntegerOnlyUnit(unit: { unit_type?: string | null; unit_name?: string | null; unit_abbr?: string | null } | null | undefined): boolean {
  if (!unit) return false;
  const name = (unit.unit_name ?? "").trim();
  const abbr = (unit.unit_abbr ?? "").trim();
  if (DECIMAL_UNIT_NAME_PATTERN.test(name) || DECIMAL_UNIT_NAME_PATTERN.test(abbr)) return false;
  if (INTEGER_UNIT_NAME_PATTERN.test(name) || INTEGER_UNIT_NAME_PATTERN.test(abbr)) return true;
  if (unit.unit_type && DECIMAL_UNIT_TYPES.has(unit.unit_type)) return false;
  if (unit.unit_type && INTEGER_UNIT_TYPES.has(unit.unit_type)) return true;
  return false;
}
