/** /api/admin/ingredient-categories — GET/POST (ingredients) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { ingredientCategoryService } from "@/services/ingredientCategoryService";

export const { GET, POST } = collectionRoutes(ingredientCategoryService, {
  sortable: ["created_at", "ingredient_category_name"],
  defaultSort: "ingredient_category_name",
  auth: { menu: "ingredients" },
});
