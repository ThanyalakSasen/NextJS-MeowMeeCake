/**
 * /api/admin/preorders
 *   GET  — รายการพรีออเดอร์ทั้งหมด (preorder.view)
 *          ?user_id= ?round_id= ?order_status= ?payment_status= ?order_type= ?search= ?date_from= ?date_to= ?includeDeleted=
 *   POST — สร้างพรีออเดอร์แทนลูกค้า (preorder.create) — body ต้องมี user_id ; รองรับ discount_amount กรอกมือ
 *          body: { user_id, round_id, order_type, delivery_address?, discount_amount?,
 *                  items: [{ round_item_id, quantity, special_request? }] }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import { parseBool, parsePagination, parseSort } from "@/lib/queryParams";
import * as preorderService from "@/services/preorderService";
import type { PreorderStatus, PaymentStatus } from "@/services/preorderService";

export const GET = withPermission("preorder", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await preorderService.listPreorders({
    pagination: parsePagination(sp),
    user_id: sp.get("user_id") ?? undefined,
    round_id: sp.get("round_id") ?? undefined,
    order_status: (sp.get("order_status") as PreorderStatus | null) ?? undefined,
    payment_status: (sp.get("payment_status") as PaymentStatus | null) ?? undefined,
    order_type: (sp.get("order_type") as "delivery" | "takeaway" | null) ?? undefined,
    search: sp.get("search") ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
    sort: parseSort(sp, ["created_at", "total_amount", "preorder_no"], "created_at"),
  });
  return ok(result);
});

export const POST = withPermission("preorder", "create", async (_s, req) => {
  const body = await req.json();
  if (!body.user_id) throw badRequest("กรุณาระบุ user_id ของลูกค้า");
  const preorder: any = await preorderService.createPreorder(
    body.user_id,
    {
      round_id: body.round_id,
      order_type: body.order_type,
      delivery_address: body.delivery_address ?? null,
      items: body.items ?? [],
      discount_amount: body.discount_amount,
    },
    { allowManualDiscount: true }
  );
  audit(req, {
    action: `สร้างพรีออเดอร์แทนลูกค้า ${preorder?.preorder_no ?? ""}`.trim(),
    action_type: "CREATE",
    entity: "Preorder",
    entity_id: preorder?._id ? String(preorder._id) : null,
    details: { for_user: body.user_id, round_id: body.round_id, total_amount: preorder?.total_amount },
  });
  return created(preorder);
});
