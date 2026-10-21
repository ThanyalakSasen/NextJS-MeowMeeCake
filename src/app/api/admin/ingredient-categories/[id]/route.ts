/** /api/admin/ingredient-categories/[id] — GET/PATCH/DELETE (ingredients) */
import { itemRoutes } from "@/lib/crudRoutes";
import { ingredientCategoryUpdate } from "@/schemas/catalog";
import { ingredientCategoryService } from "@/services/ingredientCategoryService";

export const { GET, PATCH, DELETE } = itemRoutes(ingredientCategoryService, {
  auth: { menu: "ingredients", readMenus: ["ingredient_stock", "ingredient_history"] },
  audit: { entity: "IngredientCategory" },
  validate: { update: ingredientCategoryUpdate },
});
