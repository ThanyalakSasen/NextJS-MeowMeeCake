/**
 * schemas/address — validation ของสมุดที่อยู่ลูกค้า (POST/PATCH /api/shop/addresses)
 * user_id / is_default มาจาก service (สโคปด้วย session) — ไม่รับจาก body ตรง ๆ
 * (ตรงกับ FIELDS ใน addressService)
 */
import { z } from "zod";

export const addressCreate = z.object({
  house_no: z.string().trim().min(1).max(200),
  sub_district: z.string().trim().min(1).max(120),
  district: z.string().trim().min(1).max(120),
  province: z.string().trim().min(1).max(120),
  zip_code: z.string().trim().regex(/^\d{5}$/, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก"),
  is_default: z.boolean().optional(),
});

export const addressUpdate = addressCreate.partial();
