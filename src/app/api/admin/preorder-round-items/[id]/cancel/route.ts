/**
 * POST /api/admin/preorder-round-items/[id]/cancel — ยกเลิกสินค้าออกจากรอบที่ยังเปิดอยู่แบบไม่ผลิต (preorder.update)
 *   body: { reason? } · ยกเลิกสินค้านี้ในทุกคำสั่งซื้อ คืนโควตา แล้วเอาออกจากรอบ — ดู preorderItemCancelService
 *   ต่างจาก PATCH is_active=false (ปิดการขาย) ที่คำสั่งซื้อเดิมยังผลิตต่อ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { cancelRoundItemBody } from "@/schemas/preorderRound";
import * as preorderRoundService from "@/services/preorderRoundService";
import { cancelRoundItem } from "@/services/preorderItemCancelService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("preorder", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, cancelRoundItemBody);
  const before: any = await preorderRoundService.getRoundItemById(id).catch(() => undefined);
  const result = await cancelRoundItem(id, { cancelled_by: session.user_id, reason: body.reason });
  auditChange(req, {
    op: "delete",
    verb: "ยกเลิก",
    noun: "สินค้า",
    label: before?.product_id?.product_name_th,
    suffix: before?.round_id?.round_name ? ` ออกจากรอบ "${before.round_id.round_name}" (ไม่ผลิต)` : " ออกจากรอบพรีออเดอร์ (ไม่ผลิต)",
    entity: "PreorderRoundItem",
    entity_id: id,
    before,
    keys: ["current_qty", "max_qty_total"],
  });
  return ok(result);
});
