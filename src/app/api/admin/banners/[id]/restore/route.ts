/** POST /api/admin/banners/[id]/restore — products.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { bannerService } from "@/services/bannerService";

export const { POST } = restoreRoute(bannerService, { auth: { menu: "products" } });
