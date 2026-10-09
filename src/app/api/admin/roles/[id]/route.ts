/**
 * /api/admin/roles/[id] — GET/PATCH/DELETE (employees ; กันลบถ้ามีผู้ใช้ผูกอยู่)
 * แก้ / ลบบทบาทประเภท owner ได้เฉพาะ owner (ownerProtection) · เปลี่ยน role_type ไม่ได้ (roleService.update)
 */
import { itemRoutes } from "@/lib/crudRoutes";
import { roleUpdate } from "@/schemas/rbac";
import { roleService } from "@/services/roleService";
import { assertMayManageRole } from "@/services/ownerProtection";

export const { GET, PATCH, DELETE } = itemRoutes(roleService, {
  auth: { menu: "employees" },
  audit: { entity: "Role" },
  validate: { update: roleUpdate },
  authorize: (session, { id }) => assertMayManageRole(session, id as string),
});
