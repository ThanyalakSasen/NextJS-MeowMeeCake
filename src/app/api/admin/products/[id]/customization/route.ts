/**
 * /api/admin/products/[id]/customization — ตัวเลือกสินค้าแบบกลุ่ม + ออปชันเสริม (ย้ายมาจาก backend ฝั่งลูกค้า)
 *   GET — ชุดที่ใช้งานอยู่ (products.view)
 *   PUT — บันทึกทั้งชุด (products.update) body: { groups: [...], options: [...] }
 *         มี _id = แก้ · ไม่มี _id = เพิ่ม · หายไปจากชุด = ลบ — รายละเอียดที่ productCustomizationService
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { assertObjectId } from "@/lib/objectId";
import { getProductCustomization, saveProductCustomization } from "@/services/productCustomizationService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("products", "view", async (_s, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  assertObjectId(id, "product_id");
  return ok(await getProductCustomization(id));
});

export const PUT = withPermission("products", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await saveProductCustomization(id, await req.json().catch(() => null));
  audit(req, {
    action: "แก้ไขตัวเลือกสินค้า",
    action_type: "UPDATE",
    entity: "Product",
    entity_id: id,
    details: { groups: result.groups.length, options: result.options.length },
  });
  return ok(result);
});
