/**
 * /api/admin/promotions/[id]
 *   GET    — ดูโปรโมชันรายตัว (promotions.view)
 *   PATCH  — แก้ไข (promotions.update)
 *   DELETE — ลบ soft (promotions.delete)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import { parseBody } from "@/lib/validate";
import { promotionUpdate } from "@/schemas/promotion";
import * as promotionService from "@/services/promotionService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("promotions", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await promotionService.getPromotionById(id, { includeDeleted }));
});

export const PATCH = withPermission("promotions", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, promotionUpdate);
  const keys = Object.keys(body);
  const before = await promotionService.getPromotionById(id, { includeDeleted: true }).catch(() => undefined);
  const result = await promotionService.updatePromotion(id, body);
  auditChange(req, { op: "update", noun: "โปรโมชัน", entity: "Promotion", entity_id: id, before, after: result, keys });
  return ok(result);
});

export const DELETE = withPermission("promotions", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await promotionService.deletePromotion(id);
  auditChange(req, { op: "delete", noun: "โปรโมชัน", entity: "Promotion", entity_id: id, before: result });
  return ok(result);
});
