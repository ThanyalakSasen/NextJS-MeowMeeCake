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

// รับได้ทั้ง body ของหลักและของหน้าเว็บลูกค้า (user_birthday · user_allergies) — customer-backend-merge.md §8.9
// รหัสผ่านไม่เกิน 72 ตัว (bcrypt ตัดส่วนเกินทิ้งเงียบ ๆ)
export const registerBody = z.object({
  user_fullname: nonEmpty(120),
  email,
  password: z.string().min(8, "รหัสผ่านต้องมี 8 ตัวขึ้นไป").max(72, "รหัสผ่านต้องไม่เกิน 72 ตัวอักษร"),
  // สมัครสมาชิก = เบอร์มือถือ 10 หลักเท่านั้น (ที่อื่นยังรับเบอร์บ้าน 9 หลักตาม phone ใน common)
  user_phone: z.string().trim().regex(/^0\d{9}$/, "เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก").nullish(),
  user_birthday: z.string().trim().refine((v) => !Number.isNaN(new Date(v).getTime()), "วันเกิดไม่ถูกต้อง").nullish(),
  user_birthdate: z.string().trim().refine((v) => !Number.isNaN(new Date(v).getTime()), "วันเกิดไม่ถูกต้อง").nullish(),
  user_allergies: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
});
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({
  email,
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});
export type LoginBody = z.infer<typeof loginBody>;
