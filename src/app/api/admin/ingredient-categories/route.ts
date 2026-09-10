/** /api/admin/ingredient-categories — GET/POST (ingredients) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { ingredientCategoryCreate } from "@/schemas/catalog";
import { ingredientCategoryService } from "@/services/ingredientCategoryService";

export const { GET, POST } = collectionRoutes(ingredientCategoryService, {
  sortable: ["created_at", "ingredient_category_name"],
  defaultSort: "ingredient_category_name",
  auth: { menu: "ingredients" },
  validate: { create: ingredientCategoryCreate },
});
