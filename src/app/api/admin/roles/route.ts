/** /api/admin/roles — GET/POST (employees) ; ?role_type= */
import { collectionRoutes } from "@/lib/crudRoutes";
import { roleService } from "@/services/roleService";

export const { GET, POST } = collectionRoutes(roleService, {
  sortable: ["created_at", "role_name", "role_type"],
  defaultSort: "role_name",
  filterFromQuery: (sp) => ({ role_type: sp.get("role_type") ?? undefined }),
  auth: { menu: "employees" },
  audit: { entity: "Role" },
});
