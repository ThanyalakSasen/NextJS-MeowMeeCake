/**
 * /api/admin/preorder-rounds/[id]
 *   GET    — รายละเอียดรอบ + รายการสินค้าทั้งหมด (preorder.view) ?includeDeleted=
 *   PATCH  — แก้ชื่อ/ช่วงเวลา (preorder.update) — body: { round_name?, open_date?, close_date?, pickup_date? }
 *   DELETE — ลบรอบ (soft) (preorder.delete) — บล็อกถ้ายังมีพรีออเดอร์ค้างในรอบ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import * as preorderRoundService from "@/services/preorderRoundService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("preorder", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await preorderRoundService.getRoundDetail(id, { includeDeleted }));
});

export const PATCH = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const round: any = await preorderRoundService.updateRound(id, body);
  audit(req, {
    action: `แก้ไขรอบพรีออเดอร์ "${round?.round_name ?? ""}"`,
    action_type: "UPDATE",
    entity: "PreorderRound",
    entity_id: id,
  });
  return ok(round);
});

export const DELETE = withPermission("preorder", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await preorderRoundService.deleteRound(id);
  audit(req, {
    action: "ลบรอบพรีออเดอร์",
    action_type: "DELETE",
    entity: "PreorderRound",
    entity_id: id,
  });
  return ok(result);
});
