/** GET /api/shop/preorders/[id] — พรีออเดอร์ + รายการสินค้า (เฉพาะเจ้าของ) */
import { ok } from "@/lib/apiResponse";
import { withAuth, requireOwner } from "@/lib/authGuard";
import * as preorderService from "@/services/preorderService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const preorder = await preorderService.getPreorderById(id);
  requireOwner(session, preorder.user_id);
  return ok(preorder);
});
