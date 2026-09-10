/** POST /api/admin/product-categories/[id]/restore — products.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { productCategoryService } from "@/services/productCategoryService";

export const { POST } = restoreRoute(productCategoryService, { auth: { menu: "products" } });
