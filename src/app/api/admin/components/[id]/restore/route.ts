/** POST /api/admin/components/[id]/restore — recipes.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { componentService } from "@/services/componentService";

export const { POST } = restoreRoute(componentService, {
  auth: { menu: "recipes" },
  audit: { entity: "Component" },
});
