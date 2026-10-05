/**
 * หัวข้อของฟอร์ม "ส่งข้อความหาเรา" (หน้าเว็บลูกค้า /customer/contact-us) — ย้ายมาจากฝั่งลูกค้า (customer-backend-merge.md §8.17)
 * หน้าเว็บมีสำเนาไฟล์เดียวกัน · หัวข้อที่ไม่อยู่ในรายการ = "เรื่องอื่นๆ"
 */
export const CONTACT_TOPICS = [
  "สั่งทำเค้กวันเกิด / เค้กตามสั่ง",
  "สอบถามหน้าร้านประจำสัปดาห์",
  "สั่งเค้กจัดเลี้ยง / Snack Box",
  "เรื่องอื่นๆ",
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const CONTACT_MESSAGE_MAX_LENGTH = 1000;
