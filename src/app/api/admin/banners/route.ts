/** /api/admin/banners — GET (products.view) / POST (products.create) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { parseBool } from "@/lib/queryParams";
import { bannerCreate } from "@/schemas/catalog";
import { bannerService } from "@/services/bannerService";

export const { GET, POST } = collectionRoutes(bannerService, {
  sortable: ["sort_order", "created_at", "banner_name"],
  defaultSort: "sort_order",
  filterFromQuery: (sp) => ({ is_active: parseBool(sp.get("is_active")) }),
  auth: { menu: "products" },
  validate: { create: bannerCreate },
});
