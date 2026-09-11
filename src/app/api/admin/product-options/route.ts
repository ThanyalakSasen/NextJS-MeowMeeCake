/** /api/admin/product-options — GET (products.view) / POST (products.create) ; ?product_id= */
import { collectionRoutes } from "@/lib/crudRoutes";
import { productOptionCreate } from "@/schemas/catalog";
import { productOptionService } from "@/services/productOptionService";

export const { GET, POST } = collectionRoutes(productOptionService, {
  sortable: ["created_at", "option_name", "extra_price"],
  defaultSort: "created_at",
  filterFromQuery: (sp) => ({ product_id: sp.get("product_id") ?? undefined }),
  auth: { menu: "products" },
  validate: { create: productOptionCreate },
});
