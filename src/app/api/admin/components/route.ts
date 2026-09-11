/** /api/admin/components — GET/POST (recipes) ; ?componentcategory_id= */
import { collectionRoutes } from "@/lib/crudRoutes";
import { componentCreate } from "@/schemas/bom";
import { componentService } from "@/services/componentService";

export const { GET, POST } = collectionRoutes(componentService, {
  sortable: ["created_at", "component_name", "estimated_cost_per_batch"],
  defaultSort: "component_name",
  filterFromQuery: (sp) => ({
    componentcategory_id: sp.get("componentcategory_id") ?? undefined,
  }),
  auth: { menu: "recipes" },
  audit: { entity: "Component" },
  validate: { create: componentCreate },
  createInject: (s) => ({ created_by: s.user_id }),
});
