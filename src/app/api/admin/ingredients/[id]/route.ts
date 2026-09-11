/** /api/admin/ingredients/[id] — GET/PATCH/DELETE (ingredients) ; current_stock แก้ผ่าน transactions */
import { itemRoutes } from "@/lib/crudRoutes";
import { ingredientUpdate } from "@/schemas/inventory";
import { ingredientService } from "@/services/ingredientService";

export const { GET, PATCH, DELETE } = itemRoutes(ingredientService, {
  auth: { menu: "ingredients" },
  audit: { entity: "Ingredient" },
  validate: { update: ingredientUpdate },
});
