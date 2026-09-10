/** GET /api/catalog/products/[id] — รายละเอียดสินค้า 1 ตัว (สาธารณะ) */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { notFound } from "@/lib/httpError";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const product = await productService.getProductById(id);
  // ไม่เปิดเผยสินค้าที่ถูกซ่อน
  if ((product as { is_visible?: boolean }).is_visible === false) {
    throw notFound("ไม่พบสินค้าที่ระบุ");
  }
  return ok(product);
});
