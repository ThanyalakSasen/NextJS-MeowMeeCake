/** /api/admin/units/[id] — GET/PATCH/DELETE (products) */
import { itemRoutes } from "@/lib/crudRoutes";
import { unitUpdate } from "@/schemas/catalog";
import { unitService } from "@/services/unitService";

export const { GET, PATCH, DELETE } = itemRoutes(unitService, {
  auth: { menu: "products" },
  validate: { update: unitUpdate },
});
