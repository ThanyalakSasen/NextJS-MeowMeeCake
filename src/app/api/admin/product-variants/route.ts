/** /api/admin/product-variants — GET (products.view) / POST (products.create) ; ?product_id= */
import { collectionRoutes } from "@/lib/crudRoutes";
import { productVariantService } from "@/services/productVariantService";

export const { GET, POST } = collectionRoutes(productVariantService, {
  sortable: ["created_at", "variant_name", "variant_price", "variant_stock"],
  defaultSort: "created_at",
  filterFromQuery: (sp) => ({ product_id: sp.get("product_id") ?? undefined }),
  auth: { menu: "products" },
});
