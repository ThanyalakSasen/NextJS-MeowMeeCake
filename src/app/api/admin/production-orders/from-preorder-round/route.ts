/**
 * POST /api/admin/production-orders/from-preorder-round — สร้างใบสั่งผลิตจากรอบพรีออเดอร์ (production.create)
 *   body: { round_id, production_date, assigned_to?, production_note? }
 *   เฉพาะรอบที่ round_status = "closed" เท่านั้น · สร้างได้แค่ 1 ใบต่อรอบ · รวมยอดสั่งจริงต่อสินค้า
 *   จากพรีออเดอร์ที่ยังไม่ยกเลิกในรอบนั้นให้อัตโนมัติ (ดู productionOrderService.createProductionFromRound)
 */
import { created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as productionOrderService from "@/services/productionOrderService";
import { orderForAudit } from "@/services/productionAudit";

export const POST = withPermission("production", "create", async (_s, req) => {
  const body = await req.json();
  if (!body.round_id) throw badRequest("กรุณาระบุ round_id");
  const order: any = await productionOrderService.createProductionFromRound({
    round_id: body.round_id,
    production_date: body.production_date,
    assigned_to: body.assigned_to ?? null,
    production_note: body.production_note ?? null,
  });
  const full = order?._id ? await productionOrderService.getProductionOrderById(String(order._id), { includeDeleted: true }).catch(() => undefined) : undefined;
  auditChange(req, {
    op: "create",
    noun: "ใบสั่งผลิต",
    suffix: full?.round_id?.round_name ? ` จากรอบพรีออเดอร์ "${full.round_id.round_name}"` : " จากรอบพรีออเดอร์",
    entity: "ProductionOrder",
    entity_id: order?._id ? String(order._id) : null,
    after: orderForAudit(full ?? order),
    keys: ["production_date", "assigned_to", "production_note", "items_summary"],
    details: { round_id: body.round_id },
  });
  return created(order);
});
