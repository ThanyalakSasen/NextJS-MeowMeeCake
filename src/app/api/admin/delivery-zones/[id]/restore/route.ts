/** POST /api/admin/delivery-zones/[id]/restore — orders.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { deliveryZoneService } from "@/services/deliveryZoneService";

export const { POST } = restoreRoute(deliveryZoneService, { auth: { menu: "orders" } });
