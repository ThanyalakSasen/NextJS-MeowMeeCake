// src/lib/shipping.ts — ย้ายมาจาก backend ฝั่งลูกค้า (docs/customer-backend-merge.md §8.7) · pure ไม่มี import server-only
// ค่าส่งออเดอร์/พรีออเดอร์จากหน้าเว็บลูกค้า (storefront) — หลังร้าน/POS ยังใช้ DeliveryZones (deliveryService)

export interface ShippingZone {
  /** ตัวอักษรอังกฤษตัวใหญ่ 1 ตัว — A–D คือชุดเริ่มต้น · เพิ่มโซนใหม่ได้ (E, F, …) ตั้งแต่ 2026-10-26 */
  zone_code: string;
  zone_label: string;
  provinces: string[];
  fee: number;
  /** โซน "จังหวัดอื่นทั้งหมด" — ใส่จังหวัดไม่ได้ · ลบไม่ได้ · รหัสเป็นตัวอักษรสุดท้ายของรายการเสมอ */
  is_fallback?: boolean;
}

export const ZONE_CODE_RE = /^[A-Z]$/;
/** A–Z = 26 โซน (รวมโซนจังหวัดอื่นทั้งหมด) */
export const MAX_ZONES = 26;

/** รหัสโซนลำดับที่ i (0 = A) */
export const zoneCodeAt = (i: number) => String.fromCharCode(65 + i);

/**
 * โซน "จังหวัดอื่นทั้งหมด" — ใช้กับจังหวัดที่ไม่อยู่ในโซนไหนเลย
 * ตั้ง is_fallback ไว้ = โซนนั้น · ข้อมูลเก่ายังไม่มี flag = โซนที่รหัสท้ายสุด
 */
export function fallbackZoneOf<T extends ShippingZone>(zones: T[]): T | null {
  const flagged = zones.find((z) => z.is_fallback === true);
  if (flagged) return flagged;
  const sorted = [...zones].sort((a, b) => a.zone_code.localeCompare(b.zone_code));
  return sorted[sorted.length - 1] ?? null;
}

/** โซนของจังหวัดนี้ — ตรงกับรายชื่อจังหวัดของโซนไหน = โซนนั้น · ไม่ตรง/ไม่มีจังหวัด = โซนจังหวัดอื่นทั้งหมด */
export function zoneForProvince<T extends ShippingZone>(province: string, zones: T[]): T | null {
  const trimmed = (province || "").trim();
  const fallback = fallbackZoneOf(zones);
  if (trimmed) {
    const matched = zones.find((z) => z !== fallback && z.provinces.some((p) => p.trim() === trimmed));
    if (matched) return matched;
  }
  return fallback;
}

// ข้อมูลเริ่มต้น — ใช้ seed ตอนยังไม่มีข้อมูลใน DB เลย (shippingService.getShippingZones)
// Zone D (is_fallback) ปล่อย provinces ว่างไว้โดยตั้งใจ ใช้เป็นค่า fallback สำหรับจังหวัดที่ไม่ตรงกับโซนอื่นเลย
export const DEFAULT_SHIPPING_ZONES: ShippingZone[] = [
  { zone_code: "A", zone_label: "Zone A — จังหวัดหนองคาย", provinces: ["หนองคาย"], fee: 40 },
  {
    zone_code: "B",
    zone_label: "Zone B — จังหวัดใกล้เคียง",
    provinces: ["บึงกาฬ", "หนองบัวลำภู", "อุดรธานี", "เลย"],
    fee: 60,
  },
  {
    zone_code: "C",
    zone_label: "Zone C — จังหวัดภาคอีสานอื่น ๆ",
    provinces: [
      "สกลนคร", "นครพนม", "ชัยภูมิ", "ขอนแก่น", "กาฬสินธุ์", "มุกดาหาร",
      "มหาสารคาม", "ร้อยเอ็ด", "ยโสธร", "อำนาจเจริญ", "นครราชสีมา",
      "บุรีรัมย์", "สุรินทร์", "ศรีสะเกษ", "อุบลราชธานี",
    ],
    fee: 80,
  },
  { zone_code: "D", zone_label: "Zone D — จังหวัดนอกภาคอีสาน", provinces: [], fee: 100, is_fallback: true },
];

/**
 * หาค่าจัดส่งจากจังหวัดของที่อยู่จัดส่ง — เทียบกับรายชื่อจังหวัดของทุกโซนยกเว้นโซนจังหวัดอื่นทั้งหมดก่อน
 * ถ้าไม่ตรงกับโซนไหนเลย (รวมถึงกรณียังไม่ได้เลือกที่อยู่) ให้ใช้ค่าจัดส่งของโซนจังหวัดอื่นทั้งหมด
 */
export function computeShippingFee(province: string, zones: ShippingZone[]): number {
  return zoneForProvince(province, zones)?.fee ?? 0;
}

// ── ขอบเขตการจัดส่ง ────────────────────────────────────────────────────────────
// แต่ละหมวดหมู่สินค้ามีสวิตช์ ships_nationwide (ตั้งที่ "จัดส่งนอกจังหวัด" หน้า /owner/shipping หรือจัดการหมวดหมู่สินค้า)
// เปิด = ส่งได้ทั่วประเทศ, ปิด = ส่งได้เฉพาะในจังหวัดเดียวกับร้าน · สินค้าแต่ละชิ้นตั้งยกเว้นจากหมวดได้ (productShipsNationwide)
// หมวดที่ยังไม่เคยตั้งค่า (ไม่มี field) ใช้ค่าเริ่มต้นจากชื่อหมวด: ซาวโดว์เก็บได้นาน → ส่งทั่วประเทศ
const NATIONWIDE_CATEGORY_KEYWORDS = ["ซาวโดว์", "sourdough"];

export function categoryShipsNationwide(category: {
  product_category_name?: unknown;
  ships_nationwide?: unknown;
}): boolean {
  if (typeof category.ships_nationwide === "boolean") return category.ships_nationwide;
  const name = String(category.product_category_name ?? "").toLowerCase();
  return NATIONWIDE_CATEGORY_KEYWORDS.some((k) => name.includes(k));
}

/**
 * สินค้าชิ้นนี้ส่งทั่วประเทศได้ไหม — ตั้งยกเว้นรายสินค้าไว้ (true/false) ใช้ค่านั้นก่อน · ไม่ได้ตั้ง (null) = ตามหมวด
 * เช่น หมวดเค้กส่งเฉพาะจังหวัด แต่ "เค้กกล้วยหอม" ตั้งให้ส่งทั่วประเทศได้
 */
export function productShipsNationwide(
  product: { ships_nationwide?: unknown },
  categoryNationwide: boolean
): boolean {
  return typeof product.ships_nationwide === "boolean" ? product.ships_nationwide : categoryNationwide;
}

export type DeliveryCheck = { ok: true } | { ok: false; message: string };

/**
 * ตรวจว่าจัดส่งไปจังหวัดนี้ได้ไหม — ถ้าตะกร้ามีสินค้าที่ส่งทั่วประเทศไม่ได้แม้ชิ้นเดียว ต้องส่งในจังหวัดร้านเท่านั้น
 * ถ้ายังไม่ได้ตั้งจังหวัดร้าน หรือยังไม่ได้เลือกที่อยู่ ให้ผ่านไปก่อน (ไม่บล็อกลูกค้าจากข้อมูลที่ร้านยังไม่ครบ)
 */
export function checkDeliveryArea(
  province: string,
  storeProvince: string,
  hasLocalOnlyItems: boolean
): DeliveryCheck {
  const target = (province || "").trim();
  const store = (storeProvince || "").trim();
  if (!hasLocalOnlyItems || !target || !store || target === store) return { ok: true };
  return {
    ok: false,
    message: `มีสินค้าที่จัดส่งได้เฉพาะในจังหวัด${store}เท่านั้น — กรุณาเลือกที่อยู่ในจังหวัด${store} หรือเลือกรับเองที่ร้าน`,
  };
}
