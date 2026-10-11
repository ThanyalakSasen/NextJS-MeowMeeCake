/**
 * /api/admin/preorder-round-items/[id]
 *   PATCH  — แก้ราคา/โควตา/เปิด-ปิดการขาย (preorder.update)
 *            body: { price_override?, min_order_qty?, max_qty_total?, is_active? }
 *   DELETE — ลบรายการออกจากรอบ (soft) (preorder.update) — บล็อกถ้ามีการจองแล้ว (ใช้ is_active=false แทน)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { updateRoundItemBody } from "@/schemas/preorderRound";
import * as preorderRoundService from "@/services/preorderRoundService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, updateRoundItemBody);
  const before: any = await preorderRoundService.getRoundItemById(id).catch(() => undefined);
  const item = await preorderRoundService.updateRoundItem(id, body);
  auditChange(req, {
    op: "update",
    noun: "สินค้า",
    label: before?.product_id?.product_name_th,
    suffix: before?.round_id?.round_name ? ` ในรอบ "${before.round_id.round_name}"` : "",
    entity: "PreorderRoundItem",
    entity_id: id,
    before,
    after: item,
    keys: Object.keys(body),
  });
  return ok(item);
});

export const DELETE = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before: any = await preorderRoundService.getRoundItemById(id).catch(() => undefined);
  const result = await preorderRoundService.removeRoundItem(id);
  auditChange(req, {
    op: "delete",
    verb: "ลบ",
    noun: "สินค้า",
    label: before?.product_id?.product_name_th,
    suffix: before?.round_id?.round_name ? ` ออกจากรอบ "${before.round_id.round_name}"` : " ออกจากรอบพรีออเดอร์",
    entity: "PreorderRoundItem",
    entity_id: id,
    before,
    keys: ["price_override", "max_qty_total"],
  });
  return ok(result);
});
