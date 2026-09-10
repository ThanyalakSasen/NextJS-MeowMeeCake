/** /api/admin/product-options/[id] — GET/PATCH/DELETE (products) */
import { itemRoutes } from "@/lib/crudRoutes";
import { productOptionUpdate } from "@/schemas/catalog";
import { productOptionService } from "@/services/productOptionService";

export const { GET, PATCH, DELETE } = itemRoutes(productOptionService, {
  auth: { menu: "products" },
  validate: { update: productOptionUpdate },
});
