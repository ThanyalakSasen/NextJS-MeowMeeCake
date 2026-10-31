/**
 * POST /api/admin/products/[id]/release-round — เอาสินค้าออกจากรอบพรีออเดอร์ที่ตั้งเวลา/เปิดรับ (products.delete)
 *   body: { round_item_id } · ยังไม่มีคนจอง = ลบออกจากรอบ · จองแล้ว = ปิดการขายในรอบ (ออเดอร์เดิม/การผลิตยังอยู่)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { releaseRoundBody } from "@/schemas/deleteBlockers";
import { releaseFromRound } from "@/services/deleteBlockerActions";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("products", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, releaseRoundBody);
  const result = await releaseFromRound(id, body.round_item_id);
  const product = await productService.getProductById(id, { includeDeleted: true }).catch(() => undefined);
  auditChange(req, {
    op: "update",
    verb: result.result === "removed" ? "เอาออกจากรอบ " : "ปิดการขายในรอบ ",
    noun: "สินค้า",
    label: (product as { product_name_th?: string } | undefined)?.product_name_th,
    suffix: ` "${result.round_name}" (ก่อนลบสินค้า)`,
    entity: "PreorderRoundItem",
    entity_id: body.round_item_id,
  });
  return ok(result);
});
