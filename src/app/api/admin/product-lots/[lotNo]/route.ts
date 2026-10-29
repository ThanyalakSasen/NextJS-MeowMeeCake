/**
 * GET /api/admin/product-lots/[lotNo] — ค้นล็อตจากบาร์โค้ดบนฉลาก (production / stock / pos .view)
 *   รับเลขล็อต (L2610290001) หรือรหัสประจำชิ้น (L2610290001-003 — ProductLotPieces)
 *   คืน สินค้า · วันผลิต · วันหมดอายุ · expiry_state · ใบสั่งผลิต · รอบพรีออเดอร์ · จำนวนผลิต/คงเหลือ · piece_no / piece_code (ชิ้นที่สแกน / null)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as productLotService from "@/services/productLotService";

type Ctx = { params: Promise<{ lotNo: string }> };

export const GET = withPermission(["production", "stock", "pos"], "view", async (_s, _req, ctx: Ctx) => {
  const { lotNo } = await ctx.params;
  return ok(await productLotService.getLotByNo(decodeURIComponent(lotNo)));
});
