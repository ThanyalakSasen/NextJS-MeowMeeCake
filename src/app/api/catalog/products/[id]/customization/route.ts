/** GET /api/catalog/products/[id]/customization — กลุ่มตัวเลือก + ออปชันเสริมของสินค้านี้ (สาธารณะ) */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { assertObjectId } from "@/lib/objectId";
import { getProductCustomization } from "@/services/productCustomizationService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  assertObjectId(id, "product_id");
  return ok(await getProductCustomization(id));
});
