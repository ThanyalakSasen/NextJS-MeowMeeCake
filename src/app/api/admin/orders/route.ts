/**
 * /api/admin/orders
 *   GET  — รายการออเดอร์ทั้งหมด (orders.view) — กรอง ?user_id= ?order_status= (คั่นด้วย , ได้หลายสถานะ) ?payment_status= ?order_type= ?search= ?date_from= ?date_to=
 *          ?with_items=true แนบ items[] ของแต่ละออเดอร์ (แดชบอร์ด — ออเดอร์ล่าสุด)
 *   POST — สร้างออเดอร์แทนลูกค้า (orders.create) — validate ด้วย schemas/order.adminCreateOrderBody
 *          body: { user_id, source?: "cart"|"items", order_type,
 *                  address_id? (จากสมุดที่อยู่ของ user_id + recipient_name/recipient_phone) | delivery_address?,
 *                  promotion_code?, promotion_id?, promotion_ids? (ซ้อนโปร — ทุกตัว stackable),
 *                  discount_amount?, delivery_fee?, channel?, items?, item_notes? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { parseBool, parseList, parsePagination, parseSort } from "@/lib/queryParams";
import { adminCreateOrderBody } from "@/schemas/order";
import * as orderService from "@/services/orderService";
import * as addressService from "@/services/addressService";
import type { OrderStatus, PaymentStatus } from "@/services/orderService";

export const GET = withPermission("orders", "view", async (_s, req) => {
  // หมดเวลาชำระ 30 นาทีแล้วยังไม่ส่งสลิป — ยกเลิกก่อนแสดงรายการ ไม่ต้องรอ cron (docs/customer-backend-merge.md §8.8)
  await orderService.expireUnpaidOrdersForAdmin();
  const sp = req.nextUrl.searchParams;
  const result = await orderService.listOrders({
    pagination: parsePagination(sp),
    user_id: sp.get("user_id") ?? undefined,
    order_status: parseList<OrderStatus>(sp.get("order_status")),
    payment_status: (sp.get("payment_status") as PaymentStatus | null) ?? undefined,
    order_type: (sp.get("order_type") as "delivery" | "takeaway" | null) ?? undefined,
    search: sp.get("search") ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
    sort: parseSort(sp, ["created_at", "total_amount", "order_no"], "created_at"),
    withItems: parseBool(sp.get("with_items")) ?? false,
  });
  return ok(result);
});

export const POST = withPermission(["orders", "pos"], "create", async (session, req) => {
  const body = await parseBody(req, adminCreateOrderBody);
  const delivery_address = await addressService.resolveDeliverySnapshot(body.user_id, body);
  const common = {
    order_type: body.order_type,
    delivery_address,
    promotion_code: body.promotion_code ?? null,
    promotion_id: body.promotion_id ?? null,
    promotion_ids: body.promotion_ids ?? null,
    discount_amount: body.discount_amount ?? undefined, // ส่วนลดกรอกมือ (ใช้เมื่อไม่ได้ระบุโปรโมชัน)
    // ปกติระบบคิดค่าส่งเอง — ถ้าแอดมินส่ง delivery_fee มา ถือเป็นการ override
    delivery_fee: body.delivery_fee ?? undefined,
    delivery_fee_override: body.delivery_fee != null,
    channel: body.channel,
    performed_by: session.user_id,
  };
  const order =
    body.source === "items"
      ? await orderService.createOrder(body.user_id, { ...common, items: body.items ?? [] })
      : await orderService.createOrderFromCart(body.user_id, {
          ...common,
          item_notes: body.item_notes ?? {},
        });
  auditChange(req, {
    op: "create",
    noun: "ออเดอร์",
    suffix: " แทนลูกค้า",
    entity: "Order",
    entity_id: String(order._id),
    after: order,
    keys: ["order_type", "subtotal", "discount_amount", "delivery_fee", "total_amount"],
    details: { for_user: body.user_id },
  });
  return created(order);
});
