/**
 * /api/admin/orders
 *   GET  — รายการออเดอร์ทั้งหมด (orders.view) — กรอง ?user_id= ?order_status= ?payment_status= ?order_type= ?search= ?date_from= ?date_to=
 *   POST — สร้างออเดอร์แทนลูกค้า (orders.create) — body ต้องมี user_id
 *          body: { user_id, source?: "cart"|"items", order_type, delivery_address?, promotion_id?,
 *                  discount_amount?, delivery_fee?, items?, item_notes? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import { parseBool, parsePagination, parseSort } from "@/lib/queryParams";
import * as orderService from "@/services/orderService";
import type { OrderStatus, PaymentStatus } from "@/services/orderService";

export const GET = withPermission("orders", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await orderService.listOrders({
    pagination: parsePagination(sp),
    user_id: sp.get("user_id") ?? undefined,
    order_status: (sp.get("order_status") as OrderStatus | null) ?? undefined,
    payment_status: (sp.get("payment_status") as PaymentStatus | null) ?? undefined,
    order_type: (sp.get("order_type") as "delivery" | "takeaway" | null) ?? undefined,
    search: sp.get("search") ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
    sort: parseSort(sp, ["created_at", "total_amount", "order_no"], "created_at"),
  });
  return ok(result);
});

export const POST = withPermission("orders", "create", async (_s, req) => {
  const body = await req.json();
  if (!body.user_id) throw badRequest("กรุณาระบุ user_id ของลูกค้า");
  const common = {
    order_type: body.order_type,
    delivery_address: body.delivery_address ?? null,
    promotion_code: body.promotion_code ?? null,
    promotion_id: body.promotion_id ?? null,
    discount_amount: body.discount_amount, // ส่วนลดกรอกมือ (ใช้เมื่อไม่ได้ระบุโปรโมชัน)
    // ปกติระบบคิดค่าส่งเอง — ถ้าแอดมินส่ง delivery_fee มา ถือเป็นการ override
    delivery_fee: body.delivery_fee,
    delivery_fee_override: body.delivery_fee != null,
    channel: (body.channel as "online" | "instore" | undefined) ?? "instore",
  };
  const order: any =
    body.source === "items"
      ? await orderService.createOrder(body.user_id, { ...common, items: body.items ?? [] })
      : await orderService.createOrderFromCart(body.user_id, {
          ...common,
          item_notes: body.item_notes ?? {},
        });
  audit(req, {
    action: `สร้างออเดอร์แทนลูกค้า ${order?.order_no ?? ""}`.trim(),
    action_type: "CREATE",
    entity: "Order",
    entity_id: order?._id ? String(order._id) : null,
    details: { for_user: body.user_id, total_amount: order?.total_amount },
  });
  return created(order);
});
