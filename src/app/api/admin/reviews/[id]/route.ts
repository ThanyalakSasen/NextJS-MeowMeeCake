/**
 * /api/admin/reviews/[id] — สิทธิ์เมนู reports (customer-backend-merge.md §8.20)
 *   GET    — ดูรีวิวรายตัว (view)
 *   PATCH  — จัดการรีวิว (update) body ส่งบางส่วนได้: { status?, is_pinned?, shop_reply_text? (ลูกค้าเห็น · ว่าง = ลบ · นับว่าอ่านแล้ว),
 *            internal_tags?, internal_note_text? (ว่าง = ลบ), read? }
 *   DELETE — ลบรีวิว soft (delete)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as reviewService from "@/services/reviewService";
import * as reviewModerationService from "@/services/reviewModerationService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("reports", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await reviewService.getReviewById(id));
});

export const PATCH = withPermission("reports", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const doc = await reviewModerationService.moderateReview(id, body, session.user_id);
  const what = Object.keys(body ?? {}).join(", ");
  audit(req, { action: `จัดการรีวิว (${what})`, action_type: "UPDATE", entity: "Review", entity_id: id });
  return ok(doc);
});

export const DELETE = withPermission("reports", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await reviewService.deleteReview(id);
  audit(req, { action: "ลบรีวิว", action_type: "DELETE", entity: "Review", entity_id: id });
  return ok(result);
});
