/**
 * /api/admin/preorders/[id]
 *   GET    — พรีออเดอร์ + รายการสินค้า (preorder.view) ?includeDeleted=
 *   DELETE — ลบพรีออเดอร์ (soft) (preorder.delete) — เฉพาะที่ completed/cancelled
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import * as preorderService from "@/services/preorderService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("preorder", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await preorderService.getPreorderById(id, { includeDeleted }));
});

export const DELETE = withPermission("preorder", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await preorderService.deletePreorder(id);
  audit(req, {
    action: "ลบพรีออเดอร์",
    action_type: "DELETE",
    entity: "Preorder",
    entity_id: id,
  });
  return ok(result);
});
