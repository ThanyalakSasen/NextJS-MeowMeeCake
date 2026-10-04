// src/lib/shipping.ts — ย้ายมาจาก backend ฝั่งลูกค้า (docs/customer-backend-merge.md §8.7) · pure ไม่มี import server-only
// ค่าส่งออเดอร์/พรีออเดอร์จากหน้าเว็บลูกค้า (storefront) — หลังร้าน/POS ยังใช้ DeliveryZones (deliveryService)

export interface ShippingZone {
  zone_code: "A" | "B" | "C" | "D";
  zone_label: string;
  provinces: string[];
  fee: number;
}

// ข้อมูลเริ่มต้น — ใช้ seed ตอนยังไม่มีข้อมูลใน DB เลย (shippingService.getShippingZones)
// Zone D ปล่อย provinces ว่างไว้โดยตั้งใจ ใช้เป็นค่า fallback สำหรับจังหวัดที่ไม่ตรงกับ A/B/C เลย
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
  { zone_code: "D", zone_label: "Zone D — จังหวัดนอกภาคอีสาน", provinces: [], fee: 100 },
];

/**
 * หาค่าจัดส่งจากจังหวัดของที่อยู่จัดส่ง — เทียบกับรายชื่อจังหวัดของ Zone A/B/C ก่อน
 * ถ้าไม่ตรงกับโซนไหนเลย (รวมถึงกรณียังไม่ได้เลือกที่อยู่) ให้ใช้ค่าจัดส่งของ Zone D เป็นค่า fallback
 */
export function computeShippingFee(province: string, zones: ShippingZone[]): number {
  const trimmed = (province || "").trim();
  if (trimmed) {
    const matched = zones.find(
      (z) => z.zone_code !== "D" && z.provinces.some((p) => p.trim() === trimmed)
    );
    if (matched) return matched.fee;
  }
  return zones.find((z) => z.zone_code === "D")?.fee ?? 0;
}

// ── ขอบเขตการจัดส่ง ────────────────────────────────────────────────────────────
// แต่ละหมวดหมู่สินค้ามีสวิตช์ ships_nationwide (ตั้งที่หน้า /owner/shipping)
// เปิด = ส่งได้ทั่วประเทศ, ปิด = ส่งได้เฉพาะในจังหวัดเดียวกับร้าน
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
