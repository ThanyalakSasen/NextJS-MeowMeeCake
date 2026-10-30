/**
 * schemas/auth — validation ของ /api/auth/*
 */
import { z } from "zod";
import { nonEmpty } from "./common";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("อีเมลไม่ถูกต้อง"));

/** เผื่อ 1 วัน — "วันนี้" ตามเวลาไทยเป็นเที่ยงคืน UTC ซึ่งอาจยังไม่ถึงตามนาฬิกา UTC */
const DAY_MS = 24 * 60 * 60 * 1000;
/** วันเกิด (ข้อความ): วันที่จริง · ไม่อยู่ในอนาคต · ไม่ก่อนปี 1900 (เดิมตรวจแค่ว่าแปลงเป็นวันที่ได้) */
const birthdateText = z
  .string()
  .trim()
  .refine((v) => {
    const t = new Date(v).getTime();
    return !Number.isNaN(t) && t <= Date.now() + DAY_MS && new Date(t).getUTCFullYear() >= 1900;
  }, "วันเกิดไม่ถูกต้อง (ต้องไม่อยู่ในอนาคตและไม่ก่อนปี 1900)");

// รับได้ทั้ง body ของหลักและของหน้าเว็บลูกค้า (user_birthday · user_allergies) — customer-backend-merge.md §8.9
// รหัสผ่านไม่เกิน 72 ตัว (bcrypt ตัดส่วนเกินทิ้งเงียบ ๆ)
export const registerBody = z.object({
  user_fullname: nonEmpty(120),
  email,
  password: z.string().min(8, "รหัสผ่านต้องมี 8 ตัวขึ้นไป").max(72, "รหัสผ่านต้องไม่เกิน 72 ตัวอักษร"),
  // สมัครสมาชิก = เบอร์มือถือ 10 หลักเท่านั้น (ที่อื่นยังรับเบอร์บ้าน 9 หลักตาม phone ใน common)
  user_phone: z.string().trim().regex(/^0\d{9}$/, "เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก").nullish(),
  user_birthday: birthdateText.nullish(),
  user_birthdate: birthdateText.nullish(),
  user_allergies: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
});
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({
  email,
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});
export type LoginBody = z.infer<typeof loginBody>;
