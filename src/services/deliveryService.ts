/**
 * deliveryService — คิดค่าจัดส่งฝั่ง server (ไม่เชื่อค่าที่ client ส่งมา)
 *
 * BACKLOG §3.15 — โซนหลักอ่านจาก DB (`deliveryZoneService`, แอดมินแก้เองได้ผ่าน
 * `/api/admin/delivery-zones`) cache ไว้สั้น ๆ กันยิง query ทุกครั้งที่คิดค่าส่ง
 *   - มีโซนใน DB ที่ตรงกับจังหวัด (หรือโซน is_catch_all) → ใช้ค่านั้น
 *   - ไม่มีโซนใน DB เลย (ยังไม่ตั้งค่า/deploy ใหม่) หรือมีแต่ไม่ match โซนไหนเลย → **fallback** ไปใช้
 *     "โซนตามจังหวัด" แบบ config เดิมจาก env (ประกันว่าคิดค่าส่งไม่มีวันพังแม้ยังไม่ได้ตั้งค่าโซนใน DB):
 *       - กรุงเทพฯ + ปริมณฑล  → DELIVERY_FEE_METRO      (ค่าเริ่มต้น 40)
 *       - ต่างจังหวัด          → DELIVERY_FEE_UPCOUNTRY  (ค่าเริ่มต้น 80)
 *   - ยอดสั่งซื้อ (subtotal) ถึง DELIVERY_FREE_MIN (ค่าเริ่มต้น 1500) → ส่งฟรีเสมอ ไม่ว่าจะใช้โซนไหน
 */

import dbConnect from "../lib/dbConnect";
import * as cartService from "./cartService";
import { getActiveZonesCached } from "./deliveryZoneService";

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

/** โซน fallback จาก env — ใช้เมื่อยังไม่มีโซนไหนตั้งไว้ใน DB เลย (ดูหัวไฟล์) */
const FALLBACK_ZONES: Zone[] = [
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

/** คิดค่าส่งจากจังหวัดปลายทาง + ยอดสั่งซื้อ — เช็คโซนจาก DB ก่อนเสมอ ตกไป fallback env ถ้าไม่มี/ไม่ match */
export async function calcDeliveryFee(input: {
  province?: string | null;
  subtotal: number;
}): Promise<DeliveryQuote> {
  const province = normalizeProvince(input.province);
  const free = Number(input.subtotal) >= FREE_SHIPPING_MIN;

  const dbZones = await getActiveZonesCached();
  if (dbZones.length > 0) {
    const specific = dbZones.find((z) => !z.is_catch_all && z.provinces.includes(province));
    const matched = specific ?? dbZones.find((z) => z.is_catch_all);
    if (matched) {
      return {
        fee: free ? 0 : matched.fee,
        free,
        zone: matched.zone_name,
        free_shipping_min: FREE_SHIPPING_MIN,
      };
    }
    // มีโซนตั้งไว้ใน DB แต่ไม่มีโซนไหน match เลย (ไม่ได้ตั้ง catch-all ไว้ + จังหวัดไม่อยู่ในลิสต์ไหนเลย)
    // → ตกไปใช้ fallback env ด้านล่างเหมือนกรณีไม่มีโซนใน DB เลย กันคิดค่าส่งไม่ได้กลางทาง
  }

  const zone = FALLBACK_ZONES.find((z) => z.match(province)) ?? FALLBACK_ZONES[FALLBACK_ZONES.length - 1];
  return {
    fee: free ? 0 : zone.fee,
    free,
    zone: zone.name,
    free_shipping_min: FREE_SHIPPING_MIN,
  };
}

/** โครงค่าส่งปัจจุบัน (สำหรับหน้า admin แสดง / debug) — บอกด้วยว่ากำลังใช้โซนจาก DB หรือ fallback env */
export async function listZones() {
  const dbZones = await getActiveZonesCached();
  if (dbZones.length > 0) {
    return {
      free_shipping_min: FREE_SHIPPING_MIN,
      source: "db" as const,
      zones: dbZones.map((z) => ({
        name: z.zone_name,
        fee: z.fee,
        is_catch_all: z.is_catch_all,
        provinces: z.provinces,
      })),
    };
  }
  return {
    free_shipping_min: FREE_SHIPPING_MIN,
    source: "env-fallback" as const,
    zones: FALLBACK_ZONES.map((z) => ({ name: z.name, fee: z.fee })),
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
