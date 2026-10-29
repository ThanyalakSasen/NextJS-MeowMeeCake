/**
 * GET /api/admin/product-lots/[lotNo] — ค้นล็อตจากเลขล็อต (สแกนบาร์โค้ดบนฉลาก) (production / stock / pos .view)
 *   คืน สินค้า · วันผลิต · วันหมดอายุ · expiry_state · ใบสั่งผลิต · รอบพรีออเดอร์ · จำนวนผลิต/คงเหลือ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as productLotService from "@/services/productLotService";

type Ctx = { params: Promise<{ lotNo: string }> };

export const GET = withPermission(["production", "stock", "pos"], "view", async (_s, _req, ctx: Ctx) => {
  const { lotNo } = await ctx.params;
  return ok(await productLotService.getLotByNo(decodeURIComponent(lotNo)));
});
