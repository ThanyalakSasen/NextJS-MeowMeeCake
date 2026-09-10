/** /api/admin/product-categories/[id] — GET/PATCH/DELETE (products view/update/delete) */
import { itemRoutes } from "@/lib/crudRoutes";
import { productCategoryService } from "@/services/productCategoryService";

export const { GET, PATCH, DELETE } = itemRoutes(productCategoryService, {
  auth: { menu: "products" },
});
