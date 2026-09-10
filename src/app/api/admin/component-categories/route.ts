/** /api/admin/component-categories — GET/POST (recipes) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { componentCategoryCreate } from "@/schemas/catalog";
import { componentCategoryService } from "@/services/componentCategoryService";

export const { GET, POST } = collectionRoutes(componentCategoryService, {
  sortable: ["created_at", "component_category_name"],
  defaultSort: "component_category_name",
  auth: { menu: "recipes" },
  validate: { create: componentCategoryCreate },
});
