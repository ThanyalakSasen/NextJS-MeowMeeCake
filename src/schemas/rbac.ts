/**
 * schemas/rbac — validation ของ CRUD บทบาทผู้ใช้ (role) + สิทธิ์เมนู (permission)
 * role ใช้กับ crudRoutes option `validate: { create, update }` (route: /api/admin/roles)
 * permission เป็น custom route (/api/admin/permissions) — granted_by inject จาก session เสมอ
 */
import { z } from "zod";
import { objectId } from "./common";

const ROLE_TYPES = ["owner", "staff", "customer"] as const;

export const roleCreate = z.object({
  role_name: z.string().trim().min(1).max(60),
  role_type: z.enum(ROLE_TYPES),
  is_active: z.boolean().optional(),
});
export const roleUpdate = roleCreate.partial();

const MENU_KEYS = [
  "orders",
  "preorder",
  "payments",
  "products",
  "ingredients",
  "stock",
  "recipes",
  "production",
  "employees",
  "dashboard",
  "promotions",
  "reports",
] as const;

const permissionFlags = {
  can_view: z.boolean().optional(),
  can_create: z.boolean().optional(),
  can_update: z.boolean().optional(),
  can_delete: z.boolean().optional(),
  can_approve: z.boolean().optional(),
};

/** POST /api/admin/permissions — granted_by ไม่อยู่ใน schema นี้ (inject จาก session ที่ route) */
export const permissionCreate = z.object({
  role_id: objectId,
  menu_key: z.enum(MENU_KEYS),
  expires_at: z.coerce.date().nullish(),
  ...permissionFlags,
});
export type PermissionCreateBody = z.infer<typeof permissionCreate>;

/** PATCH /api/admin/permissions/[id] — แก้ได้เฉพาะ flag การอนุญาต + วันหมดอายุ · ต้องส่งมาอย่างน้อย 1 ฟิลด์ */
export const permissionUpdate = z
  .object({
    expires_at: z.coerce.date().nullish(),
    ...permissionFlags,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "ไม่มีฟิลด์ที่อนุญาตให้แก้ไข (can_view/can_create/.../expires_at)",
  });
export type PermissionUpdateBody = z.infer<typeof permissionUpdate>;
