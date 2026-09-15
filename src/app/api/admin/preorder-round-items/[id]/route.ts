/**
 * /api/admin/preorder-round-items/[id]
 *   PATCH  — แก้ราคา/โควตา/เปิด-ปิดการขาย (preorder.update)
 *            body: { price_override?, min_order_qty?, max_qty_total?, is_active? }
 *   DELETE — ลบรายการออกจากรอบ (soft) (preorder.update) — บล็อกถ้ามีการจองแล้ว (ใช้ is_active=false แทน)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { updateRoundItemBody } from "@/schemas/preorderRound";
import * as preorderRoundService from "@/services/preorderRoundService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, updateRoundItemBody);
  const item = await preorderRoundService.updateRoundItem(id, body);
  audit(req, {
    action: "แก้ไขรายการสินค้าในรอบพรีออเดอร์",
    action_type: "UPDATE",
    entity: "PreorderRoundItem",
    entity_id: id,
  });
  return ok(item);
});

export const DELETE = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await preorderRoundService.removeRoundItem(id);
  audit(req, {
    action: "ลบรายการสินค้าออกจากรอบพรีออเดอร์",
    action_type: "DELETE",
    entity: "PreorderRoundItem",
    entity_id: id,
  });
  return ok(result);
});
