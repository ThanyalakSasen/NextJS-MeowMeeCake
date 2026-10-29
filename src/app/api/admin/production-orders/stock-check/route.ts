/**
 * POST /api/admin/production-orders/stock-check — เช็ควัตถุดิบพอผลิตไหม ระหว่างกรอกฟอร์มสร้างใบสั่งผลิต
 *   (production.create — ใช้ในฟอร์มสร้างเท่านั้น · ไม่บันทึกอะไร)
 *   body: { items: [{ recipe_id, planned_qty }] }
 *   คืน: items[i] วัตถุดิบที่ไม่พอของแถวนั้น + ผลิตได้สูงสุด · total_shortages รวมทุกแถว
 *   (ดู productionItemService.checkIngredientStock)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseBody } from "@/lib/validate";
import { productionStockCheckBody } from "@/schemas/bom";
import * as productionItemService from "@/services/productionItemService";

export const POST = withPermission("production", "create", async (_s, req) => {
  const body = await parseBody(req, productionStockCheckBody);
  return ok(await productionItemService.checkIngredientStock(body.items));
});
