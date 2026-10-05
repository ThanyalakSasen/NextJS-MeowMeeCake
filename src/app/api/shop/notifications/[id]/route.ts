/** PATCH /api/shop/notifications/[id] — อ่านรายการเดียว → { item, unread_count } · ไม่ใช่ของตัวเอง/ไม่พบ = 404 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as customerNotifyService from "@/services/customerNotifyService";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await customerNotifyService.markRead(session.user_id, id));
});
