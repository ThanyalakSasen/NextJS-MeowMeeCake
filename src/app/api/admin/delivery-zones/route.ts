/**
 * /api/admin/delivery-zones — GET (orders.view) / POST (orders.create)
 * BACKLOG §3.15 — โซนค่าจัดส่งที่แอดมินแก้เองได้ (แทน env DELIVERY_FEE_METRO/UPCOUNTRY ตายตัวเดิม)
 */
import { collectionRoutes } from "@/lib/crudRoutes";
import { parseBool } from "@/lib/queryParams";
import { deliveryZoneCreate } from "@/schemas/delivery";
import { deliveryZoneService } from "@/services/deliveryZoneService";

export const { GET, POST } = collectionRoutes(deliveryZoneService, {
  sortable: ["sort_order", "created_at", "zone_name"],
  defaultSort: "sort_order",
  filterFromQuery: (sp) => ({ is_active: parseBool(sp.get("is_active")) }),
  auth: { menu: "orders" },
  validate: { create: deliveryZoneCreate },
});
