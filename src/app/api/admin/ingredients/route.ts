/** /api/admin/ingredients — GET/POST (ingredients) ; ?search= ?ingredient_category_id= */
import { collectionRoutes } from "@/lib/crudRoutes";
import { ingredientCreate } from "@/schemas/inventory";
import { ingredientService } from "@/services/ingredientService";

export const { GET, POST } = collectionRoutes(ingredientService, {
  sortable: ["created_at", "ingredient_name", "current_stock", "cost_per_unit"],
  defaultSort: "ingredient_name",
  filterFromQuery: (sp) => ({
    ingredient_category_id: sp.get("ingredient_category_id") ?? undefined,
  }),
  auth: { menu: "ingredients" },
  audit: { entity: "Ingredient" },
  validate: { create: ingredientCreate },
});
