/**
 * schemas/user — validation ของการแก้โปรไฟล์ตัวเอง (PATCH /api/shop/me) +
 * CRUD ผู้ใช้ฝั่งแอดมิน (/api/admin/users)
 */
import { z } from "zod";
import { phone, objectId } from "./common";

export const updateProfileBody = z
  .object({
    user_fullname: z.string().trim().min(1).max(120),
    user_birthdate: z.coerce.date().nullable(),
    user_phone: phone.nullable(),
    user_img: z.string().trim().max(1000).nullable(),
    user_allergies: z.array(z.string().trim().min(1).max(100)),
  })
  .partial();

const EMPLOYMENT_TYPES = ["full_time", "part_time"] as const;

/** field โปรไฟล์ + การจ้างงานที่ทั้ง create/update ใช้ร่วมกัน (ไม่รวม auth/identity field) */
const employeeShape = {
  user_birthdate: z.coerce.date().nullish(),
  user_phone: phone.nullish(),
  user_img: z.string().trim().max(1000).nullish(),
  user_allergies: z.array(z.string().trim().min(1).max(100)).optional(),
  is_active: z.boolean().optional(),
  start_working_date: z.coerce.date().nullish(),
  employment_type: z.enum(EMPLOYMENT_TYPES).nullish(),
  emp_salary: z.coerce.number().nonnegative().nullish(),
  part_time_hours: z.coerce.number().nonnegative().nullish(),
  emp_status: z.boolean().nullish(),
};

/** POST /api/admin/users — password/googleId บังคับตาม auth_provider (เช็คที่ service ไม่ใช่ zod
 *  เพราะเป็น conditional ข้าม field + business rule เดียวกับที่ต้องเช็ค role มีจริงด้วย) */
export const createUserBody = z.object({
  user_fullname: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  auth_provider: z.enum(["local", "google"]),
  role_id: objectId,
  password: z.string().optional(),
  googleId: z.string().optional(),
  ...employeeShape,
});
export type CreateUserBody = z.infer<typeof createUserBody>;

/** PATCH /api/admin/users/[id] — แก้โปรไฟล์/การจ้างงาน/email/role_id/is_active (ไม่รวม password/auth) */
export const updateUserBody = z.object({
  user_fullname: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role_id: objectId.optional(),
  last_working_date: z.coerce.date().nullish(),
  ...employeeShape,
});
export type UpdateUserBody = z.infer<typeof updateUserBody>;
