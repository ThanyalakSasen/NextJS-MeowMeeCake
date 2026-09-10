/** /api/admin/component-categories/[id] — GET/PATCH/DELETE (recipes) */
import { itemRoutes } from "@/lib/crudRoutes";
import { componentCategoryService } from "@/services/componentCategoryService";

export const { GET, PATCH, DELETE } = itemRoutes(componentCategoryService, {
  auth: { menu: "recipes" },
});
