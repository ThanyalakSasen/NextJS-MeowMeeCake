/** /api/admin/recipes/[id] — GET/PATCH/DELETE (recipes) */
import { itemRoutes } from "@/lib/crudRoutes";
import { recipeService } from "@/services/recipeService";

export const { GET, PATCH, DELETE } = itemRoutes(recipeService, {
  auth: { menu: "recipes" },
  audit: { entity: "Recipe" },
});
