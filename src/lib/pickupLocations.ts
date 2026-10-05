// ─────────────────────────────────────────────────────────────
// src/lib/pickupLocations.ts — ย้ายมาจาก backend ฝั่งลูกค้า (docs/customer-backend-merge.md §8.7)
// จุดรับสินค้า (รับเอง) = "หน้าร้านประจำสัปดาห์" (StoreProfile.weekly_markets) ที่เปิดแสดงอยู่ — รวมหน้าร้านหลัก
// กติกาวันรับ:
//   - ออเดอร์ปกติ: วันที่จุดนั้นเปิด ภายใน ORDER_PICKUP_WINDOW_DAYS วันข้างหน้า (วันนี้ได้ถ้ายังไม่เลยเวลาปิด)
//   - พรีออเดอร์: วันรับของรอบ (round.pickup_date) ต่อไปอีก PICKUP_EXTRA_DAYS วัน เฉพาะวันที่จุดนั้นเปิด
// วันที่คิดตามเวลาไทย (Asia/Bangkok) เสมอ — server อาจรันเป็น UTC · pure ไม่มี import server-only
// ─────────────────────────────────────────────────────────────

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_SHORT_TH: Record<DayKey, string> = {
  mon: "จ.", tue: "อ.", wed: "พ.", thu: "พฤ.", fri: "ศ.", sat: "ส.", sun: "อา.",
};

export interface PickupLocation {
  _id: string;
  name: string;
  location: string;
  days: DayKey[];
  open_time: string; // "HH:mm"
  close_time: string;
  map_url: string;
}

/** สั่งสินค้าปกติแบบรับเอง เลือกวันรับได้ภายในกี่วันข้างหน้า (รวมวันนี้) */
export const ORDER_PICKUP_WINDOW_DAYS = 14;
/** พรีออเดอร์: เลือกวันรับได้เลยวันรับของรอบไปอีกกี่วัน (รวมวันรับของรอบ = PICKUP_EXTRA_DAYS + 1 วัน) */
export const PICKUP_EXTRA_DAYS = 12;

const TZ = "Asia/Bangkok";
const DAY_MS = 24 * 60 * 60 * 1000;

/** แปลงเวลาเป็น key วันที่ตามเวลาไทย "YYYY-MM-DD" */
export function bangkokDateKey(date: Date | string): string | null {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** key "YYYY-MM-DD" → Date เที่ยงคืนเวลาไทยของวันนั้น (ใช้เก็บลง DB) */
export function dateKeyToBangkokMidnight(key: string): Date {
  return new Date(`${key}T00:00:00+07:00`);
}

/** วันในสัปดาห์ของ key "YYYY-MM-DD" (ตามเวลาไทย) */
export function dayKeyOf(dateKey: string): DayKey {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" })
    .format(dateKeyToBangkokMidnight(dateKey))
    .toLowerCase()
    .slice(0, 3) as DayKey;
}

export function isLocationOpenOn(loc: Pick<PickupLocation, "days">, dateKey: string): boolean {
  return loc.days.includes(dayKeyOf(dateKey));
}

function bangkokTimeNow(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

/** ตัวเลือกวันรับของสินค้าปกติ — วันที่จุดนั้นเปิด ภายใน ORDER_PICKUP_WINDOW_DAYS วันข้างหน้า */
export function orderPickupDateOptions(loc: PickupLocation, now: Date = new Date()): string[] {
  const todayKey = bangkokDateKey(now);
  if (!todayKey) return [];
  const start = dateKeyToBangkokMidnight(todayKey).getTime();
  const keys: string[] = [];
  for (let i = 0; i < ORDER_PICKUP_WINDOW_DAYS; i++) {
    const key = bangkokDateKey(new Date(start + i * DAY_MS));
    if (!key || !isLocationOpenOn(loc, key)) continue;
    if (i === 0 && bangkokTimeNow(now) >= loc.close_time) continue;
    keys.push(key);
  }
  return keys;
}

/** ช่วงวันรับทั้งหมดของรอบพรีออเดอร์ (ยังไม่กรองวันเปิดของจุด) */
export function roundPickupDateRange(roundPickupDate: Date | string | null | undefined): string[] {
  if (!roundPickupDate) return [];
  const firstKey = bangkokDateKey(roundPickupDate);
  if (!firstKey) return [];
  const start = dateKeyToBangkokMidnight(firstKey).getTime();
  const keys: string[] = [];
  for (let i = 0; i <= PICKUP_EXTRA_DAYS; i++) {
    const key = bangkokDateKey(new Date(start + i * DAY_MS));
    if (key) keys.push(key);
  }
  return keys;
}

/** ตัวเลือกวันรับของพรีออเดอร์ — ช่วงวันของรอบ เฉพาะวันที่จุดนั้นเปิด */
export function preorderPickupDateOptions(loc: PickupLocation, roundPickupDate: Date | string | null | undefined): string[] {
  return roundPickupDateRange(roundPickupDate).filter((key) => isLocationOpenOn(loc, key));
}

/** สรุปวัน-เวลาเปิดของจุด เช่น "ศ. ส. · 17:00 - 22:00 น." (ทุกวัน → "ทุกวัน") */
export function formatLocationSchedule(loc: Pick<PickupLocation, "days" | "open_time" | "close_time">): string {
  const days = DAY_ORDER.filter((d) => loc.days.includes(d));
  const dayText = days.length === 7 ? "ทุกวัน" : days.map((d) => DAY_SHORT_TH[d]).join(" ");
  return `${dayText} · ${loc.open_time} - ${loc.close_time} น.`;
}
