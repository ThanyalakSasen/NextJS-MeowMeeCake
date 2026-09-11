/** POST /api/admin/units/[id]/restore — products.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { unitService } from "@/services/unitService";

export const { POST } = restoreRoute(unitService, { auth: { menu: "products" } });
