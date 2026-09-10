/**
 * GET /api/admin/pos/scan?code=<รหัสสินค้า | _id>
 *   ใช้ตอนสแกนบาร์โค้ดหน้าร้าน — code รับได้ทั้ง product_id (เช่น "pos-0126487") หรือ _id ดิบ
 *   คืน: { product, current_price, stock, variants }
 *   ถ้ามี variants ให้ POS ให้พนักงานเลือกก่อนเพิ่มลงบิล
 *
 *   สิทธิ์: orders.view (พนักงานหน้าร้าน)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import * as productService from "@/services/productService";

export const GET = withPermission("orders", "view", async (_s, req) => {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) throw badRequest("กรุณาระบุ ?code=");
  return ok(await productService.resolveScan(code));
});
