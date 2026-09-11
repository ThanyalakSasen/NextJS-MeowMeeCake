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

export const registerBody = z.object({
  user_fullname: nonEmpty(120),
  email,
  password: z.string().min(8, "รหัสผ่านอย่างน้อย 8 ตัวอักษร").max(200),
  user_phone: phone.nullish(),
});
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({
  email,
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});
export type LoginBody = z.infer<typeof loginBody>;
