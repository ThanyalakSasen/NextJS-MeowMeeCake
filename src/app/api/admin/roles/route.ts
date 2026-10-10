/** /api/admin/roles — GET/POST (employees) ; ?role_type= · สร้างบทบาทประเภท owner ได้เฉพาะ owner (ownerProtection) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { roleCreate } from "@/schemas/rbac";
import { roleService } from "@/services/roleService";
import { assertMayCreateRoleType } from "@/services/ownerProtection";

export const { GET, POST } = collectionRoutes(roleService, {
  sortable: ["created_at", "role_name", "role_type"],
  defaultSort: "role_name",
  filterFromQuery: (sp) => ({ role_type: sp.get("role_type") ?? undefined }),
  auth: { menu: "employees" },
  audit: { entity: "Role" },
  validate: { create: roleCreate },
  authorize: (session, { body }) => assertMayCreateRoleType(session, body?.role_type),
});
