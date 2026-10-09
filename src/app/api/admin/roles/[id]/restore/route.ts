/** POST /api/admin/roles/[id]/restore — employees.update · กู้คืนบทบาทประเภท owner ได้เฉพาะ owner (ownerProtection) */
import { restoreRoute } from "@/lib/crudRoutes";
import { roleService } from "@/services/roleService";
import { assertMayManageRole } from "@/services/ownerProtection";

export const { POST } = restoreRoute(roleService, {
  auth: { menu: "employees" },
  audit: { entity: "Role" },
  authorize: (session, { id }) => assertMayManageRole(session, id as string),
});
