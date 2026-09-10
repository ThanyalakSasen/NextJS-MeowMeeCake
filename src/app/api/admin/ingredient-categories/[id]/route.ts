/** /api/admin/ingredient-categories/[id] — GET/PATCH/DELETE (ingredients) */
import { itemRoutes } from "@/lib/crudRoutes";
import { ingredientCategoryService } from "@/services/ingredientCategoryService";

export const { GET, PATCH, DELETE } = itemRoutes(ingredientCategoryService, {
  auth: { menu: "ingredients" },
});
