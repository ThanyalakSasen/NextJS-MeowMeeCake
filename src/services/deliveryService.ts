/**
 * deliveryService — คิดค่าจัดส่งฝั่ง server (ไม่เชื่อค่าที่ client ส่งมา)
 *
 * รุ่นนี้ใช้ "โซนตามจังหวัด" แบบ config (ปรับผ่าน env ได้) :
 *   - กรุงเทพฯ + ปริมณฑล  → DELIVERY_FEE_METRO      (ค่าเริ่มต้น 40)
 *   - ต่างจังหวัด          → DELIVERY_FEE_UPCOUNTRY  (ค่าเริ่มต้น 80)
 *   - ยอดสั่งซื้อ (subtotal) ถึง DELIVERY_FREE_MIN (ค่าเริ่มต้น 1500) → ส่งฟรี
 *
 * ต่อยอดภายหลัง: เปลี่ยนไปอ่านตารางโซนจาก DB (admin แก้เองได้) — แก้เฉพาะไฟล์นี้
 */

import dbConnect from "../lib/dbConnect";
import * as cartService from "./cartService";

function envNum(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const FREE_SHIPPING_MIN = envNum(process.env.DELIVERY_FREE_MIN, 1500);
const FEE_METRO = envNum(process.env.DELIVERY_FEE_METRO, 40);
const FEE_UPCOUNTRY = envNum(process.env.DELIVERY_FEE_UPCOUNTRY, 80);

// ชื่อจังหวัด/รูปแบบที่นับเป็น "กรุงเทพฯ + ปริมณฑล"
const METRO_PROVINCES = new Set([
  "กรุงเทพมหานคร",
  "กรุงเทพ",
  "กทม",
  "กทม.",
  "นนทบุรี",
  "ปทุมธานี",
  "สมุทรปราการ",
  "สมุทรสาคร",
  "นครปฐม",
]);

interface Zone {
  name: string;
  fee: number;
  match: (province: string) => boolean;
}

const ZONES: Zone[] = [
  {
    name: "กรุงเทพฯ และปริมณฑล",
    fee: FEE_METRO,
    match: (p) => METRO_PROVINCES.has(p),
  },
  {
    name: "ต่างจังหวัด",
    fee: FEE_UPCOUNTRY,
    match: () => true, // catch-all
  },
];

function normalizeProvince(p: unknown): string {
  return String(p ?? "")
    .trim()
    .replace(/^จังหวัด\s*/, "")
    .replace(/^จ\.\s*/, "");
}

export interface DeliveryQuote {
  fee: number;
  free: boolean;
  zone: string;
  free_shipping_min: number;
}

/** คิดค่าส่งจากจังหวัดปลายทาง + ยอดสั่งซื้อ */
export function calcDeliveryFee(input: {
  province?: string | null;
  subtotal: number;
}): DeliveryQuote {
  const province = normalizeProvince(input.province);
  const zone = ZONES.find((z) => z.match(province)) ?? ZONES[ZONES.length - 1];
  const free = Number(input.subtotal) >= FREE_SHIPPING_MIN;
  return {
    fee: free ? 0 : zone.fee,
    free,
    zone: zone.name,
    free_shipping_min: FREE_SHIPPING_MIN,
  };
}

/** โครงค่าส่งปัจจุบัน (สำหรับหน้า admin แสดง / debug) */
export function listZones() {
  return {
    free_shipping_min: FREE_SHIPPING_MIN,
    zones: ZONES.map((z) => ({ name: z.name, fee: z.fee })),
  };
}

/** พรีวิวค่าส่งจากตะกร้าปัจจุบันของผู้ใช้ (ใช้ที่ /api/shop/orders/delivery-quote) */
export async function quoteForCart(
  userId: string,
  address: { province?: string | null } | null
): Promise<DeliveryQuote> {
  await dbConnect();
  const detail = await cartService.getCartDetail(userId);
  return calcDeliveryFee({
    province: address?.province ?? null,
    subtotal: detail.summary.subtotal,
  });
}
