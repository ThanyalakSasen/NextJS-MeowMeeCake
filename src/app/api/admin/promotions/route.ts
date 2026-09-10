/**
 * /api/admin/promotions
 *   GET  — รายการโปรโมชัน (promotions.view) ?search= ?is_active= ?discount_type= ?activeNow= ?includeDeleted=
 *   POST — สร้างโปรโมชัน (promotions.create) — created_by = ผู้ทำรายการ
 *          body: { promotion_code, promotion_name, discount_type, discount_value, start_date, end_date,
 *                  promotion_desc?, is_active?, applicable_channels?, min_order_amount?, min_quantity?,
 *                  applicable_products?, applicable_categories?, max_discount_amount?, usage_limit?, max_user_per_user? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool, parsePagination } from "@/lib/queryParams";
import * as promotionService from "@/services/promotionService";

export const GET = withPermission("promotions", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await promotionService.listPromotions({
    pagination: parsePagination(sp),
    search: sp.get("search") ?? undefined,
    is_active: parseBool(sp.get("is_active")),
    discount_type: sp.get("discount_type") ?? undefined,
    activeNow: parseBool(sp.get("activeNow")) ?? false,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
  });
  return ok(result);
});

export const POST = withPermission("promotions", "create", async (session, req) => {
  const body = await req.json();
  const result: any = await promotionService.createPromotion(body, session.user_id);
  audit(req, {
    action: `สร้างโปรโมชัน ${body.promotion_code ?? ""}`.trim(),
    action_type: "CREATE",
    entity: "Promotion",
    entity_id: result?._id ? String(result._id) : null,
    details: { discount_type: body.discount_type, discount_value: body.discount_value },
  });
  return created(result);
});
