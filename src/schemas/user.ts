/**
 * schemas/user — validation ของการแก้โปรไฟล์ตัวเอง (PATCH /api/shop/me)
 * เขียนได้เฉพาะฟิลด์โปรไฟล์ — email / role_id / is_active / ข้อมูลการจ้างงาน แก้ที่นี่ไม่ได้
 * (ตรงกับ PROFILE_FIELDS ใน userService.updateProfile)
 */
import { z } from "zod";
import { phone } from "./common";

export const updateProfileBody = z
  .object({
    user_fullname: z.string().trim().min(1).max(120),
    user_birthdate: z.coerce.date().nullable(),
    user_phone: phone.nullable(),
    user_img: z.string().trim().max(1000).nullable(),
    user_allergies: z.array(z.string().trim().min(1).max(100)),
  })
  .partial();
