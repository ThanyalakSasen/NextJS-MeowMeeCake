/** /api/admin/recipes — GET/POST (recipes) ; ?product_id= */
import { collectionRoutes } from "@/lib/crudRoutes";
import { recipeCreate } from "@/schemas/bom";
import { recipeService } from "@/services/recipeService";

export const { GET, POST } = collectionRoutes(recipeService, {
  sortable: ["created_at", "recipe_name", "estimated_cost_per_batch"],
  defaultSort: "created_at",
  filterFromQuery: (sp) => ({ product_id: sp.get("product_id") ?? undefined }),
  auth: { menu: "recipes" },
  audit: { entity: "Recipe" },
  validate: { create: recipeCreate },
});
