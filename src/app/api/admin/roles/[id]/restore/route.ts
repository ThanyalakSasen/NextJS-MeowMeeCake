/** POST /api/admin/roles/[id]/restore — employees.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { roleService } from "@/services/roleService";

export const { POST } = restoreRoute(roleService, {
  auth: { menu: "employees" },
  audit: { entity: "Role" },
});
