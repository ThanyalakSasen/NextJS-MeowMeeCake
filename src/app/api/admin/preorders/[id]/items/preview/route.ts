/**
 * POST /api/admin/preorders/[id]/items/preview — ตรวจสอบยอดก่อนเปลี่ยนสินค้า (preorder.update · ไม่เขียนอะไร)
 *   body เดียวกับ PUT /items · ตอบ { before, after, outcome: none|refund|extra|unpaid, refund, extra, lines, quota_errors, customer_message }
 *   ดู services/preorderEditService.ts previewPreorderEdit
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseBody } from "@/lib/validate";
import { adminEditPreorderItemsBody } from "@/schemas/preorder";
import { previewPreorderEdit } from "@/services/preorderEditService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, adminEditPreorderItemsBody);
  return ok(await previewPreorderEdit(id, body));
});
