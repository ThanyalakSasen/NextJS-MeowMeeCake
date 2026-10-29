/**
 * GET /api/admin/product-lots/[lotNo]/pieces — รหัสประจำชิ้นทั้งล็อต [{ piece_no, piece_code }] เรียงตามลำดับ
 *   (production / stock / pos .view) · ใช้พิมพ์ฉลาก 1 ดวงต่อชิ้น · ล็อตเก่าที่ยังไม่มีรหัสชิ้น สร้างให้ตอนเรียกครั้งแรก
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as productLotService from "@/services/productLotService";

type Ctx = { params: Promise<{ lotNo: string }> };

export const GET = withPermission(["production", "stock", "pos"], "view", async (_s, _req, ctx: Ctx) => {
  const { lotNo } = await ctx.params;
  return ok(await productLotService.listPieces(decodeURIComponent(lotNo)));
});
