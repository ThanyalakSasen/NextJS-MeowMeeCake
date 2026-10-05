/**
 * POST /api/shop/points/share — { product_id } แชร์สินค้าได้ 5 แต้ม ครั้งเดียวต่อสินค้า → { awarded }
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { badRequest, notFound } from "@/lib/httpError";
import { isObjectId } from "@/lib/objectId";
import dbConnect from "@/lib/dbConnect";
import productModel from "@/models/productModel";
import * as pointsService from "@/services/pointsService";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => ({}));
  if (!isObjectId(body?.product_id)) throw badRequest("product_id ไม่ถูกต้อง");
  await dbConnect();
  const product = await productModel
    .findOne({ _id: body.product_id, deleted_at: null })
    .select("product_name_th")
    .lean<{ _id: unknown; product_name_th?: string } | null>();
  if (!product) throw notFound("ไม่พบสินค้า");
  return ok(await pointsService.awardShare(session.user_id, product));
});
