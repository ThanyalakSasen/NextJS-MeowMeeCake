/**
 * schemas/auth — validation ของ /api/auth/*
 */
import { z } from "zod";
import { nonEmpty, phone } from "./common";

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
  password: z.string().min(8, "รหัสผ่านอย่างน้อย 8 ตัวอักษร").max(72, "รหัสผ่านต้องไม่เกิน 72 ตัวอักษร"),
  user_phone: phone.nullish(),
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
