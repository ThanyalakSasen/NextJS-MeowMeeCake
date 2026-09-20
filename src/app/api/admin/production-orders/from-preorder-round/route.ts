/**
 * POST /api/admin/production-orders/from-preorder-round — สร้างใบสั่งผลิตจากรอบพรีออเดอร์ (production.create)
 *   body: { round_id, production_date, assigned_to?, production_note? }
 *   เฉพาะรอบที่ round_status = "closed" เท่านั้น · สร้างได้แค่ 1 ใบต่อรอบ · รวมยอดสั่งจริงต่อสินค้า
 *   จากพรีออเดอร์ที่ยังไม่ยกเลิกในรอบนั้นให้อัตโนมัติ (ดู productionOrderService.createProductionFromRound)
 */
import { created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as productionOrderService from "@/services/productionOrderService";

export const POST = withPermission("production", "create", async (_s, req) => {
  const body = await req.json();
  if (!body.round_id) throw badRequest("กรุณาระบุ round_id");
  const order: any = await productionOrderService.createProductionFromRound({
    round_id: body.round_id,
    production_date: body.production_date,
    assigned_to: body.assigned_to ?? null,
    production_note: body.production_note ?? null,
  });
  audit(req, {
    action: `สร้างใบสั่งผลิตจากรอบพรีออเดอร์ ${order?.production_no ?? ""}`.trim(),
    action_type: "CREATE",
    entity: "ProductionOrder",
    entity_id: order?._id ? String(order._id) : null,
    details: { round_id: body.round_id, item_count: order?.items?.length ?? 0 },
  });
  return created(order);
});
