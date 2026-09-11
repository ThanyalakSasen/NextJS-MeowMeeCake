/** PATCH /api/admin/reviews/[id]/visibility — ซ่อน/แสดงรีวิว (products.update) body: { is_visible: boolean } */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { badRequest } from "@/lib/httpError";
import * as reviewService from "@/services/reviewService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("products", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (typeof body.is_visible !== "boolean") throw badRequest("is_visible ต้องเป็น true หรือ false");
  return ok(await reviewService.setReviewVisibility(id, body.is_visible));
});
