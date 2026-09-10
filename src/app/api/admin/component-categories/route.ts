/** /api/admin/component-categories — GET/POST (recipes) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { componentCategoryService } from "@/services/componentCategoryService";

export const { GET, POST } = collectionRoutes(componentCategoryService, {
  sortable: ["created_at", "component_category_name"],
  defaultSort: "component_category_name",
  auth: { menu: "recipes" },
});
