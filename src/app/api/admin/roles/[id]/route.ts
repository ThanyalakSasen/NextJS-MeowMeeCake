/** /api/admin/roles/[id] — GET/PATCH/DELETE (employees ; กันลบถ้ามีผู้ใช้ผูกอยู่) */
import { itemRoutes } from "@/lib/crudRoutes";
import { roleUpdate } from "@/schemas/rbac";
import { roleService } from "@/services/roleService";

export const { GET, PATCH, DELETE } = itemRoutes(roleService, {
  auth: { menu: "employees" },
  audit: { entity: "Role" },
  validate: { update: roleUpdate },
});
