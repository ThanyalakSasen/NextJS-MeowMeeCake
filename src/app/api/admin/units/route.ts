/** /api/admin/units — GET (products.view) / POST (products.create) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { unitService } from "@/services/unitService";

export const { GET, POST } = collectionRoutes(unitService, {
  sortable: ["created_at", "unit_name", "unit_abbr", "unit_type"],
  defaultSort: "unit_name",
  filterFromQuery: (sp) => ({
    unit_type: sp.get("unit_type") ?? undefined,
    usage_context: sp.get("usage_context") ?? undefined,
  }),
  auth: { menu: "products" },
});
