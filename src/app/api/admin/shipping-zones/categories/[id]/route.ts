/**
 * PATCH /api/admin/shipping-zones/categories/:id — ตั้งว่าหมวดนี้ส่งทั่วประเทศได้ไหม (store_info.update)
 *   body { ships_nationwide: boolean, reset_products?: boolean } · ปิด = ออเดอร์เว็บที่มีสินค้าหมวดนี้ส่งได้เฉพาะจังหวัดของร้าน
 *   reset_products = ล้างค่ายกเว้นรายสินค้าในหมวด (เปิด/ปิดทั้งหมวด — สวิตช์หัวหมวดในหน้า "จัดส่งนอกจังหวัด") · ตอบ products_reset
 *   ใช้สิทธิ์เดียวกับโซนค่าส่ง — พนักงานที่ดูแลค่าจัดส่งไม่ต้องมีสิทธิ์จัดการสินค้า · เขียน audit log
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { categoryShippingUpdate } from "@/schemas/shipping";
import * as shippingService from "@/services/shippingService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("store_info", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { ships_nationwide, reset_products } = await parseBody(req, categoryShippingUpdate);
  const { before, after, products_reset } = await shippingService.setCategoryShipsNationwide(id, ships_nationwide, {
    resetProducts: reset_products,
  });
  auditChange(req, {
    op: "update",
    verb: "ตั้งขอบเขตจัดส่ง",
    noun: "หมวดหมู่สินค้า",
    label: after.product_category_name,
    suffix: products_reset > 0 ? ` (ล้างค่ารายสินค้า ${products_reset} รายการ)` : undefined,
    entity: "ProductCategory",
    entity_id: after._id,
    before,
    after,
    keys: ["ships_nationwide"],
  });
  return ok({ ...after, products_reset });
});
