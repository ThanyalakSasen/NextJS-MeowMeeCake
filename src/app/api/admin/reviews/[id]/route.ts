/**
 * /api/admin/reviews/[id] — สิทธิ์เมนู reports (customer-backend-merge.md §8.20)
 *   GET    — ดูรีวิวรายตัว (view)
 *   PATCH  — จัดการรีวิว (update) body ส่งบางส่วนได้: { status?, is_pinned?, shop_reply_text? (ลูกค้าเห็น · ว่าง = ลบ · นับว่าอ่านแล้ว),
 *            internal_tags?, internal_note_text? (ว่าง = ลบ), read? }
 *   DELETE — ลบรีวิว soft (delete)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import * as reviewService from "@/services/reviewService";
import * as reviewModerationService from "@/services/reviewModerationService";

type Ctx = { params: Promise<{ id: string }> };

const reviewLabel = (r: any) => (r ? [r.product_id?.product_name_th, r.user_id?.user_fullname].filter(Boolean).join(" · ") || undefined : undefined);
/** คีย์ใน body ของการจัดการรีวิว → ฟิลด์ในเอกสารที่เปลี่ยนจริง */
const MODERATE_FIELDS: Record<string, string[]> = {
  status: ["status", "is_visible"],
  shop_reply_text: ["shop_reply"],
};

export const GET = withPermission("reports", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await reviewService.getReviewById(id));
});

export const PATCH = withPermission("reports", "update", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const before = await reviewService.getReviewById(id).catch(() => undefined);
  const doc = await reviewModerationService.moderateReview(id, body, session.user_id);
  const after = await reviewService.getReviewById(id).catch(() => undefined);
  auditChange(req, {
    op: "update",
    verb: "จัดการ",
    noun: "รีวิว",
    label: reviewLabel(after ?? before),
    entity: "Review",
    entity_id: id,
    before,
    after: after ?? doc,
    keys: Object.keys(body ?? {}).flatMap((k) => MODERATE_FIELDS[k] ?? [k]),
  });
  return ok(doc);
});

export const DELETE = withPermission("reports", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before = await reviewService.getReviewById(id).catch(() => undefined);
  const result = await reviewService.deleteReview(id);
  auditChange(req, {
    op: "delete",
    noun: "รีวิว",
    label: reviewLabel(before),
    entity: "Review",
    entity_id: id,
    before,
    keys: ["rating", "review_text"],
  });
  return ok(result);
});
