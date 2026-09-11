/** POST /api/admin/recipes/[id]/restore — recipes.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { recipeService } from "@/services/recipeService";

export const { POST } = restoreRoute(recipeService, {
  auth: { menu: "recipes" },
  audit: { entity: "Recipe" },
});
