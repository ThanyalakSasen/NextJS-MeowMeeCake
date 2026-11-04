/**
 * PUT /api/admin/preorders/[id]/items — ร้านเปลี่ยนสินค้าในพรีออเดอร์ (preorder.update)
 *   body: { keep: [{ item_id, quantity }], add: [{ round_item_id, quantity, variant_ids?, selected_options?, special_request? }], reason?, allow_extra_payment? }
 *   รายการเดิมที่ไม่อยู่ใน keep = เอาออก · ชำระแล้ว: ถูกลง = ส่วนต่างเข้า "รอโอนคืน" · แพงขึ้นต้องส่ง allow_extra_payment: true = "รอชำระเพิ่ม"
 *   ดู services/preorderEditService.ts
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { adminEditPreorderItemsBody } from "@/schemas/preorder";
import * as preorderService from "@/services/preorderService";
import { editPreorderItems } from "@/services/preorderEditService";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, adminEditPreorderItemsBody);
  const before = await preorderService.getPreorderById(id).catch(() => undefined);
  const result = await editPreorderItems(id, body);
  auditChange(req, {
    op: "update",
    verb: "แก้ไขรายการสินค้า",
    noun: "พรีออเดอร์",
    entity: "Preorder",
    entity_id: id,
    before,
    after: result.preorder,
    keys: ["subtotal", "discount_amount", "total_amount", "refund_due_amount", "extra_due_amount"],
  });
  return ok(result);
});
