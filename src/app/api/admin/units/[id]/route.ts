/** /api/admin/units/[id] — GET/PATCH/DELETE (products) */
import { itemRoutes } from "@/lib/crudRoutes";
import { unitService } from "@/services/unitService";

export const { GET, PATCH, DELETE } = itemRoutes(unitService, { auth: { menu: "products" } });
