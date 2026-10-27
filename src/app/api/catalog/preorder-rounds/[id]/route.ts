/**
 * GET /api/catalog/preorder-rounds/[id] — รายละเอียดรอบ + รายการสินค้าที่เปิดขาย (สาธารณะ)
 *   คืนเฉพาะรายการ is_active=true ที่สินค้ายังมีอยู่ (ไม่ถูกลบ · ไม่ถูกซ่อน) พร้อม current_price / remaining_qty
 */
import { ok, route } from "@/lib/apiResponse";
import * as preorderRoundService from "@/services/preorderRoundService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const round = await preorderRoundService.getRoundDetail(id, { activeItemsOnly: true });
  return ok(round);
});
