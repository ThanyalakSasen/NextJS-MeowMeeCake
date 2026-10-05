/**
 * PATCH /api/admin/reviews/[id]/visibility — ซ่อน/แสดงรีวิว (reports.update) body: { is_visible: boolean }
 * เท่ากับ PATCH /api/admin/reviews/[id] { status: approved | hidden } — status กับ is_visible เปลี่ยนคู่กัน (§8.20)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as reviewService from "@/services/reviewService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withPermission("reports", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (typeof body?.is_visible !== "boolean") throw badRequest("is_visible ต้องเป็น true หรือ false");
  const doc = await reviewService.setReviewVisibility(id, body.is_visible);
  audit(req, { action: body.is_visible ? "แสดงรีวิว" : "ซ่อนรีวิว", action_type: "UPDATE", entity: "Review", entity_id: id });
  return ok(doc);
});
