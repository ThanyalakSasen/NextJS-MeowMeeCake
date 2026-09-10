/** /api/admin/banners/[id] — GET/PATCH/DELETE (products) */
import { itemRoutes } from "@/lib/crudRoutes";
import { bannerService } from "@/services/bannerService";

export const { GET, PATCH, DELETE } = itemRoutes(bannerService, { auth: { menu: "products" } });
