/**
 * /api/admin/preorder-rounds/[id]
 *   GET    — รายละเอียดรอบ + รายการสินค้าทั้งหมด (preorder.view) ?includeDeleted=
 *   PATCH  — แก้ชื่อ/ช่วงเวลา (preorder.update) — body: { round_name?, open_date?, close_date?, pickup_date? }
 *   DELETE — ลบรอบ (soft) (preorder.delete) — บล็อกถ้ายังมีพรีออเดอร์ค้างในรอบ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { parseBool } from "@/lib/queryParams";
import { updateRoundBody } from "@/schemas/preorderRound";
import * as preorderRoundService from "@/services/preorderRoundService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("preorder", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await preorderRoundService.getRoundDetail(id, { includeDeleted }));
});

export const PATCH = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, updateRoundBody);
  const before = await preorderRoundService.getRoundById(id, { includeDeleted: true }).catch(() => undefined);
  const round = await preorderRoundService.updateRound(id, body);
  auditChange(req, {
    op: "update",
    noun: "รอบพรีออเดอร์",
    entity: "PreorderRound",
    entity_id: id,
    before,
    after: round,
    keys: Object.keys(body),
  });
  return ok(round);
});

export const DELETE = withPermission("preorder", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before = await preorderRoundService.getRoundById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await preorderRoundService.deleteRound(id);
  auditChange(req, {
    op: "delete",
    noun: "รอบพรีออเดอร์",
    entity: "PreorderRound",
    entity_id: id,
    before,
    keys: ["round_status", "open_date", "close_date", "pickup_date"],
  });
  return ok(result);
});
