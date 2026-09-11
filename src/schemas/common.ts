/**
 * schemas/common — zod schema ชิ้นเล็กที่ใช้ซ้ำหลาย route
 */
import { z } from "zod";
import { Types } from "mongoose";

/** ObjectId ในรูป string (24 hex) */
export const objectId = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), "รูปแบบ id ไม่ถูกต้อง");

/** เบอร์โทรไทย: ขึ้นต้น 0 ตามด้วยตัวเลข 8-9 ตัว */
export const phone = z
  .string()
  .trim()
  .regex(/^0\d{8,9}$/, "เบอร์โทรไม่ถูกต้อง");

/** ที่อยู่จัดส่งแบบ object ดิบ (service ตรวจ field ที่จำเป็นอีกชั้น) */
export const deliveryAddress = z.record(z.string(), z.string());

/** query pagination — coerce จาก string ของ URLSearchParams */
export const pageQuery = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
};

/** query sort — ใช้กับ parseSort ต่อ (คง whitelist ที่ route) */
export const sortQuery = {
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
};

/** string ที่ trim แล้วต้องไม่ว่าง + จำกัดความยาว */
export const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
