/** /api/admin/units — GET (view ของ products · ingredients · recipes · stock) / POST (products.create) */
import { collectionRoutes } from "@/lib/crudRoutes";
import { unitCreate } from "@/schemas/catalog";
import { unitService } from "@/services/unitService";

export const { GET, POST } = collectionRoutes(unitService, {
  sortable: ["created_at", "unit_name", "unit_abbr", "unit_type"],
  defaultSort: "unit_name",
  filterFromQuery: (sp) => ({
    unit_type: sp.get("unit_type") ?? undefined,
    usage_context: sp.get("usage_context") ?? undefined,
  }),
  // อ่านหน่วยนับได้จากหน้าวัตถุดิบ · สูตร · สต็อกด้วย (เดิมต้องมี products.view — frontend Final-Backlog P2)
  auth: { menu: "products", readMenus: ["ingredients", "recipes", "stock"] },
  audit: { entity: "Unit" },
  validate: { create: unitCreate },
});
