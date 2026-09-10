/**
 * /api/admin/promotions/[id]
 *   GET    — ดูโปรโมชันรายตัว (promotions.view)
 *   PATCH  — แก้ไข (promotions.update)
 *   DELETE — ลบ soft (promotions.delete)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
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
  const result = await promotionService.updatePromotion(id, body);
  audit(req, {
    action: "แก้ไขโปรโมชัน",
    action_type: "UPDATE",
    entity: "Promotion",
    entity_id: id,
    details: Object.keys(body),
  });
  return ok(result);
});

export const DELETE = withPermission("promotions", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await promotionService.deletePromotion(id);
  audit(req, { action: "ลบโปรโมชัน", action_type: "DELETE", entity: "Promotion", entity_id: id });
  return ok(result);
});
