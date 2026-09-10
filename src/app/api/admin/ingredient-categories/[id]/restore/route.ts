/** POST /api/admin/ingredient-categories/[id]/restore — ingredients.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { ingredientCategoryService } from "@/services/ingredientCategoryService";

export const { POST } = restoreRoute(ingredientCategoryService, { auth: { menu: "ingredients" } });
