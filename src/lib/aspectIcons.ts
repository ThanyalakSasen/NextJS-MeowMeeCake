// src/lib/aspectIcons.ts — ย้ายมาจาก backend ฝั่งลูกค้า (customer-backend-merge.md §8.20 · หน้าเว็บมี AspectIcon.tsx คู่กัน)
// ไอคอนของแง่มุมรีวิว — เก็บใน DB เป็น "key" (ไม่ใช่ชื่อ component) ใช้ได้ทั้งฝั่ง server (ตรวจค่า) และ client
// key → ไอคอนจริง (lucide-react) อยู่ที่หน้าเว็บ src/app/components/AspectIcon.tsx — เพิ่มไอคอนต้องเพิ่มทั้งสองที่

export const ASPECT_ICON_KEYS = [
  "wallet", "badge-percent", "cookie", "cake", "cake-slice", "croissant", "candy", "ice-cream", "coffee", "utensils",
  "package", "gift", "truck", "clock", "store", "smile", "heart", "star", "sparkles", "eye",
  "leaf", "flame", "snowflake", "scale", "shield-check", "message-circle", "more",
] as const;

export type AspectIconKey = (typeof ASPECT_ICON_KEYS)[number];

export function isAspectIconKey(value: unknown): value is AspectIconKey {
  return typeof value === "string" && (ASPECT_ICON_KEYS as readonly string[]).includes(value);
}

// ไอคอนเริ่มต้นของชุดแง่มุมที่ seed ไว้ (จับคู่ตามชื่ออังกฤษ) — ใช้เมื่อยังไม่เคยเลือกไอคอนเอง
const DEFAULT_BY_ENG_NAME: Record<string, AspectIconKey> = {
  price: "wallet",
  taste: "cookie",
  packaging: "package",
  others: "more",
};

/** ไอคอนที่ใช้แสดงจริง: ที่ร้านเลือกไว้ → ค่าเริ่มต้นตามชื่ออังกฤษ → "more" */
export function resolveAspectIconKey(icon: unknown, nameEng?: string | null): AspectIconKey {
  if (isAspectIconKey(icon)) return icon;
  return DEFAULT_BY_ENG_NAME[(nameEng ?? "").trim().toLowerCase()] ?? "more";
}
