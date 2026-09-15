/**
 * /api/admin/preorder-rounds
 *   GET  — รายการรอบพรีออเดอร์ทั้งหมด (preorder.view) — ?status= ?search= ?includeDeleted= ?page= ?limit=
 *   POST — สร้างรอบใหม่ (preorder.create)
 *          body: { round_name, open_date, close_date, pickup_date, round_status?,
 *                  items?: [{ product_id, price_override?, min_order_qty?, max_qty_total, is_active? }] }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { parseBool, parsePagination, parseSort } from "@/lib/queryParams";
import { createRoundBody } from "@/schemas/preorderRound";
import * as preorderRoundService from "@/services/preorderRoundService";
import type { RoundStatus } from "@/services/preorderRoundService";

export const GET = withPermission("preorder", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await preorderRoundService.listRounds({
    pagination: parsePagination(sp),
    round_status: (sp.get("status") as RoundStatus | null) ?? undefined,
    search: sp.get("search") ?? undefined,
    upcomingOnly: parseBool(sp.get("upcomingOnly")) ?? false,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
    sort: parseSort(sp, ["open_date", "close_date", "pickup_date", "created_at"], "open_date"),
  });
  return ok(result);
});

export const POST = withPermission("preorder", "create", async (session, req) => {
  const body = await parseBody(req, createRoundBody);
  const round = await preorderRoundService.createRound(body, session.user_id);
  audit(req, {
    action: `สร้างรอบพรีออเดอร์ "${round?.round_name ?? ""}"`,
    action_type: "CREATE",
    entity: "PreorderRound",
    entity_id: round?._id ? String(round._id) : null,
    details: { round_status: round?.round_status, item_count: round?.items?.length ?? 0 },
  });
  return created(round);
});
