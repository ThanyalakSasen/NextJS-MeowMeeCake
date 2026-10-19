/**
 * /api/admin/shipping-zones/products — ขอบเขตจัดส่งของออเดอร์เว็บแบบยกเว้นรายสินค้า ("จัดส่งนอกจังหวัด")
 *   GET   (store_info.view)   สินค้าทั้งหมด + ค่าที่ตั้งยกเว้น (null = ตามหมวด) + ค่าของหมวด + ค่าที่ใช้จริง
 *   PATCH (store_info.update) body { product_ids: [...], ships_nationwide: true | false | null } — ตั้งหลายชิ้นพร้อมกัน
 *         true = ส่งทั่วประเทศ · false = เฉพาะจังหวัดร้าน · null = กลับไปใช้ค่าตามหมวด · เขียน audit log
 */
import { ok, okList } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { productShippingUpdate } from "@/schemas/shipping";
import * as shippingService from "@/services/shippingService";

export const GET = withPermission("store_info", "view", async () => okList(await shippingService.listProductShipping()));

export const PATCH = withPermission("store_info", "update", async (_s, req) => {
  const { product_ids, ships_nationwide } = await parseBody(req, productShippingUpdate);
  const { updated, before, after } = await shippingService.setProductShipping(product_ids, ships_nationwide);
  auditChange(req, {
    op: "update",
    verb: "ตั้งขอบเขตจัดส่ง",
    noun: "สินค้า",
    label: `${updated} รายการ`,
    entity: "Product",
    entity_id: product_ids.length === 1 ? product_ids[0] : null,
    before: { items: before },
    after: { items: after },
    keys: ["items"],
  });
  return ok({ updated, ships_nationwide });
});
