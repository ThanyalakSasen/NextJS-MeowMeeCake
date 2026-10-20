/** /api/admin/banners/[id] — GET/PATCH/DELETE (products) */
import { itemRoutes } from "@/lib/crudRoutes";
import { bannerUpdate } from "@/schemas/catalog";
import { bannerService } from "@/services/bannerService";

export const { GET, PATCH, DELETE } = itemRoutes(bannerService, {
  auth: { menu: "store_design" },
  audit: { entity: "Banner" },
  validate: { update: bannerUpdate },
});
