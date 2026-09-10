/** /api/admin/product-categories — GET (products.view) / POST (products.create) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { productCategoryService } from "@/services/productCategoryService";

export const { GET, POST } = collectionRoutes(productCategoryService, {
  sortable: ["created_at", "product_category_name"],
  defaultSort: "product_category_name",
  auth: { menu: "products" },
});
