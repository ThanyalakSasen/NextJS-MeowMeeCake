/**
 * /api/admin/production-orders
 *   GET  — รายการใบสั่งผลิต (production.view) — ?round_id= กรองเฉพาะใบที่มาจากรอบพรีออเดอร์นั้น
 *   POST — สร้างใบสั่งผลิตเอง (production.create ; source_type บังคับเป็น "manual" เสมอ)
 *          body: { production_date, assigned_to?, production_note?, items?: [{ product_id, recipe_id, planned_qty, notes? }] }
 *          สร้างจากรอบพรีออเดอร์ให้ใช้ POST /admin/production-orders/from-preorder-round แทน
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseBool, parsePagination } from "@/lib/queryParams";
import * as productionOrderService from "@/services/productionOrderService";
import type { ProductionStatus } from "@/services/productionOrderService";

export const GET = withPermission("production", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await productionOrderService.listProductionOrders({
    pagination: parsePagination(sp),
    production_status: (sp.get("production_status") as ProductionStatus | null) ?? undefined,
    source_type: (sp.get("source_type") as "manual" | "preorder" | null) ?? undefined,
    round_id: sp.get("round_id") ?? undefined,
    assigned_to: sp.get("assigned_to") ?? undefined,
    search: sp.get("search") ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
  });
  return ok(result);
});

export const POST = withPermission("production", "create", async (_s, req) => {
  const body = await req.json();
  return created(await productionOrderService.createProductionOrder(body));
});
