/**
 * POST /api/admin/reviews/bulk — ทำหลายรีวิวพร้อมกัน (reports.update · ย้ายมาจาก /api/owner/reviews/bulk · §8.20)
 *   body { ids: [...] (≤ 200), action: "mark_read" | "mark_unread" } → { matched, modified }
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as reviewModerationService from "@/services/reviewModerationService";

export const POST = withPermission("reports", "update", async (session, req) =>
  ok(await reviewModerationService.bulkMarkRead(await req.json().catch(() => null), session.user_id))
);
