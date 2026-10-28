/**
 * บริษัทขนส่งของออเดอร์/พรีออเดอร์แบบจัดส่ง (orderModel/preorderModel.shipping_carrier)
 * เก็บเป็นรหัส — หน้าแอดมิน/หน้าลูกค้าแปลชื่อเอง · ชื่อไทยที่นี่ใช้ในข้อความแจ้งลูกค้า (customerNotifyService)
 */
export const SHIPPING_CARRIERS = [
  "thailand_post",
  "kerry",
  "flash",
  "jt",
  "ninjavan",
  "best",
  "scg",
  "lalamove",
  "grab",
  "lineman",
  "store",
  "other",
] as const;

export type ShippingCarrier = (typeof SHIPPING_CARRIERS)[number];

export const SHIPPING_CARRIER_TEXT: Record<ShippingCarrier, string> = {
  thailand_post: "ไปรษณีย์ไทย",
  kerry: "KEX (Kerry Express)",
  flash: "Flash Express",
  jt: "J&T Express",
  ninjavan: "Ninja Van",
  best: "BEST Express",
  scg: "SCG Express",
  lalamove: "Lalamove",
  grab: "Grab Express",
  lineman: "LINE MAN",
  store: "ร้านจัดส่งเอง",
  other: "อื่น ๆ",
};

/**
 * ขนส่งพัสดุที่มีเลขติดตาม — ออเดอร์/พรีออเดอร์แบบจัดส่งที่ใช้ขนส่งพวกนี้ต้องมี tracking_no ก่อนปิดเป็น completed
 * ไรเดอร์ (lalamove/grab/lineman) · ร้านส่งเอง · อื่น ๆ ไม่บังคับ (ตรงกับหน้าเว็บ constants/enumConfig.ts carrierNeedsTracking)
 */
const TRACKED_CARRIERS: readonly ShippingCarrier[] = ["thailand_post", "kerry", "flash", "jt", "ninjavan", "best", "scg"];

export const carrierNeedsTracking = (carrier: ShippingCarrier) => TRACKED_CARRIERS.includes(carrier);
