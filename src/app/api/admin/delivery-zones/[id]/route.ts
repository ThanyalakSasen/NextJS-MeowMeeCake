/** /api/admin/delivery-zones/[id] — GET/PATCH/DELETE (orders) */
import { itemRoutes } from "@/lib/crudRoutes";
import { deliveryZoneUpdate } from "@/schemas/delivery";
import { deliveryZoneService } from "@/services/deliveryZoneService";

export const { GET, PATCH, DELETE } = itemRoutes(deliveryZoneService, {
  auth: { menu: "orders" },
  validate: { update: deliveryZoneUpdate },
});
