/** /api/admin/units/[id] — GET (view ของ products · ingredients · recipes · stock) / PATCH/DELETE (products) */
import { itemRoutes } from "@/lib/crudRoutes";
import { unitUpdate } from "@/schemas/catalog";
import { unitService } from "@/services/unitService";

export const { GET, PATCH, DELETE } = itemRoutes(unitService, {
  // อ่านหน่วยนับได้จากหน้าวัตถุดิบ · สูตร · สต็อกด้วย (เดิมต้องมี products.view — frontend Final-Backlog P2)
  auth: { menu: "products", readMenus: ["ingredients", "recipes", "stock"] },
  audit: { entity: "Unit" },
  validate: { update: unitUpdate },
});
