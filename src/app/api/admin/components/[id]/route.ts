/** /api/admin/components/[id] — GET/PATCH/DELETE (recipes) */
import { itemRoutes } from "@/lib/crudRoutes";
import { componentService } from "@/services/componentService";

export const { GET, PATCH, DELETE } = itemRoutes(componentService, {
  auth: { menu: "recipes" },
  audit: { entity: "Component" },
});
