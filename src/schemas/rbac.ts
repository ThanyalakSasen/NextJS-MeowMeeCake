/**
 * schemas/rbac — validation ของ CRUD บทบาทผู้ใช้ (role)
 * ใช้กับ crudRoutes option `validate: { create, update }` (route: /api/admin/roles)
 */
import { z } from "zod";

const ROLE_TYPES = ["owner", "staff", "customer"] as const;

export const roleCreate = z.object({
  role_name: z.string().trim().min(1).max(60),
  role_type: z.enum(ROLE_TYPES),
  is_active: z.boolean().optional(),
});
export const roleUpdate = roleCreate.partial();
