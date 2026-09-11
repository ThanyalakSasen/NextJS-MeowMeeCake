/** POST /api/admin/component-categories/[id]/restore — recipes.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { componentCategoryService } from "@/services/componentCategoryService";

export const { POST } = restoreRoute(componentCategoryService, { auth: { menu: "recipes" } });
