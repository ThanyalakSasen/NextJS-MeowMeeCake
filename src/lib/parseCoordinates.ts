// src/lib/parseCoordinates.ts — ย้ายมาจาก backend ฝั่งลูกค้า (customer-backend-merge.md §8.19 · หน้าเว็บมีสำเนาไฟล์เดียวกัน)
// อ่านพิกัด (ละติจูด, ลองจิจูด) จากข้อความที่ร้านกรอก — ใช้ทั้งช่องกรอกพิกัด (client) และตัวแปลงลิงก์ย่อ (server)
// รองรับ: "17.878, 102.742" · ลิงก์ Google Maps แบบเต็ม · ลิงก์ย่อ (maps.app.goo.gl) ต้องให้ server แปลงก่อน

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";

// รูปแบบพิกัดที่พบในลิงก์ Google Maps แบบเต็ม (เรียงจากแม่นที่สุด)
const URL_PATTERNS = [
  new RegExp(`!3d${NUM}!4d${NUM}`),                  // ตำแหน่งหมุดจริงของสถานที่
  new RegExp(`[?&](?:q|query|ll|destination|center)=${NUM},\\s*${NUM}`),
  new RegExp(`@${NUM},${NUM}`),                       // กึ่งกลางแผนที่ที่กำลังดูอยู่
];
const PLAIN = new RegExp(`^\\s*${NUM}\\s*[,\\s]\\s*${NUM}\\s*$`);

const SHORT_LINK_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+$/i;

export type ParseResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; error: string; shortLink?: boolean };

/** ลิงก์แบบย่อของ Google Maps (ต้องให้ server ตาม redirect ก่อนถึงจะเห็นพิกัด) */
export function isShortMapLink(input: string): boolean {
  return SHORT_LINK_RE.test(input.trim());
}

export function parseCoordinates(input: string): ParseResult {
  let text = input.trim();
  try { text = decodeURIComponent(text); } catch { /* มี % ที่ไม่ใช่ URL-encoding — ใช้ข้อความเดิม */ }
  if (!text) return { ok: false, error: "" };

  if (isShortMapLink(text)) {
    return { ok: false, shortLink: true, error: "ลิงก์แบบย่อ — กำลังอ่านพิกัดจากลิงก์..." };
  }

  const match = PLAIN.exec(text) ?? URL_PATTERNS.map((re) => re.exec(text)).find(Boolean);
  if (!match) {
    return { ok: false, error: "ไม่พบพิกัด — กรอกเป็น \"ละติจูด, ลองจิจูด\" เช่น 17.878, 102.742 หรือวางลิงก์ Google Maps" };
  }

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, error: "พิกัดอยู่นอกช่วงที่ถูกต้อง (ละติจูด -90 ถึง 90, ลองจิจูด -180 ถึง 180)" };
  }
  return { ok: true, lat, lng };
}
