/**
 * PATCH /api/admin/reviews/[id]/visibility — ซ่อน/แสดงรีวิว (reports.update) body: { is_visible: boolean }
 * เท่ากับ PATCH /api/admin/reviews/[id] { status: approved | hidden } — status กับ is_visible เปลี่ยนคู่กัน (§8.20)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as reviewService from "@/services/reviewService";

type Ctx = { params: Promise<{ id: string }> };

const reviewLabel = (r: any) => (r ? [r.product_id?.product_name_th, r.user_id?.user_fullname].filter(Boolean).join(" · ") || undefined : undefined);

export const PATCH = withPermission("reports", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (typeof body?.is_visible !== "boolean") throw badRequest("is_visible ต้องเป็น true หรือ false");
  const before = await reviewService.getReviewById(id).catch(() => undefined);
  const doc = await reviewService.setReviewVisibility(id, body.is_visible);
  auditChange(req, {
    op: "update",
    verb: body.is_visible ? "แสดง" : "ซ่อน",
    noun: "รีวิว",
    label: reviewLabel(before),
    entity: "Review",
    entity_id: id,
    before,
    after: await reviewService.getReviewById(id).catch(() => undefined) ?? doc,
    keys: ["is_visible", "status"],
  });
  return ok(doc);
});
