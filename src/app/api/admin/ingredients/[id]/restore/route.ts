/** POST /api/admin/ingredients/[id]/restore — ingredients.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { ingredientService } from "@/services/ingredientService";

export const { POST } = restoreRoute(ingredientService, {
  auth: { menu: "ingredients" },
  audit: { entity: "Ingredient" },
});
