/** /api/admin/product-variants/[id] — GET/PATCH/DELETE (products) */
import { itemRoutes } from "@/lib/crudRoutes";
import { productVariantUpdate } from "@/schemas/catalog";
import { productVariantService } from "@/services/productVariantService";

export const { GET, PATCH, DELETE } = itemRoutes(productVariantService, {
  auth: { menu: "products" },
  validate: { update: productVariantUpdate },
});
