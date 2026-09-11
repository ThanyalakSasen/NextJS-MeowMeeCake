/** /api/admin/component-categories/[id] — GET/PATCH/DELETE (recipes) */
import { itemRoutes } from "@/lib/crudRoutes";
import { componentCategoryUpdate } from "@/schemas/catalog";
import { componentCategoryService } from "@/services/componentCategoryService";

export const { GET, PATCH, DELETE } = itemRoutes(componentCategoryService, {
  auth: { menu: "recipes" },
  validate: { update: componentCategoryUpdate },
});
