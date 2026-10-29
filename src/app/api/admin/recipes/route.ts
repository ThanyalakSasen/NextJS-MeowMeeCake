/** /api/admin/recipes — GET/POST (recipes) ; ?product_id=
 *  GET อ่านได้จากหน้าผลิตด้วย (production) — ฟอร์มสร้างใบสั่งผลิตต้องรู้ว่าสินค้าไหนมีสูตร (ทุกรายการในใบต้องผูก recipe_id) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { recipeCreate } from "@/schemas/bom";
import { recipeService } from "@/services/recipeService";

export const { GET, POST } = collectionRoutes(recipeService, {
  sortable: ["created_at", "recipe_name", "estimated_cost_per_batch"],
  defaultSort: "created_at",
  filterFromQuery: (sp) => ({ product_id: sp.get("product_id") ?? undefined }),
  auth: { menu: "recipes", readMenus: ["production"] },
  audit: { entity: "Recipe" },
  validate: { create: recipeCreate },
  createInject: (s) => ({ created_by: s.user_id }),
});
