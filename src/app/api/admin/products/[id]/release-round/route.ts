/**
 * POST /api/admin/products/[id]/release-round — เอาสินค้าออกจากรอบพรีออเดอร์ที่ตั้งเวลา/เปิดรับ (products.delete)
 *   body: { round_item_id, keep_orders? } · ยังไม่มีคนจอง = ลบออกจากรอบ · จองแล้ว = ปิดการขายในรอบ (ออเดอร์เดิม/การผลิตยังอยู่)
 *   keep_orders: true = มีออเดอร์ค้าง — ยกเลิกสินค้าในรอบ (รอบปิดแล้วก็ได้) ออเดอร์/การผลิตยังอยู่ แล้วลบสินค้าได้
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { releaseRoundBody } from "@/schemas/deleteBlockers";
import { releaseFromRound, releasePreorders } from "@/services/deleteBlockerActions";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("products", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, releaseRoundBody);
  const result = body.keep_orders ? await releasePreorders(id, body.round_item_id) : await releaseFromRound(id, body.round_item_id);
  const product = await productService.getProductById(id, { includeDeleted: true }).catch(() => undefined);
  auditChange(req, {
    op: "update",
    verb: result.result === "removed" ? "เอาออกจากรอบ " : result.result === "released" ? "ยกเลิกสินค้าในรอบ " : "ปิดการขายในรอบ ",
    noun: "สินค้า",
    label: (product as { product_name_th?: string } | undefined)?.product_name_th,
    suffix: ` "${result.round_name}" (ก่อนลบสินค้า${result.result === "released" ? " — ออเดอร์ค้างยังผลิตต่อ" : ""})`,
    entity: "PreorderRoundItem",
    entity_id: body.round_item_id,
  });
  return ok(result);
});
