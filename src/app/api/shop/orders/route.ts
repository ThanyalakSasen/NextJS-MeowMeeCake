/**
 * /api/shop/orders  (ออเดอร์ของผู้ใช้ที่ล็อกอินเท่านั้น)
 *   GET  — รายการออเดอร์ของตัวเอง (?order_status=&payment_status=&order_type=&page=&limit=&sortBy=&sortOrder=)
 *   POST — สั่งซื้อของตัวเอง — ตรวจ body ด้วย schemas/order.createOrderBody
 *          body: { source?: "cart"|"items", order_type, delivery_address?,
 *                  promotion_code? | promotion_id?, items?, item_notes? }
 *          - ค่าส่ง (delivery_fee) คิดฝั่ง server จากที่อยู่ + ยอดสั่งซื้อ — ลูกค้ากรอกเองไม่ได้
 *          - ส่วนลดคิดจากโปรโมชันที่ระบบตรวจเอง — กรอก discount_amount เองไม่ได้
 *          - พรีวิวค่าส่งก่อนกดสั่ง: POST /api/shop/orders/delivery-quote
 */
import { ok, created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parsePagination, parseSort } from "@/lib/queryParams";
import { parseBody, parseQuery } from "@/lib/validate";
import { createOrderBody, listOrderQuery } from "@/schemas/order";
import * as orderService from "@/services/orderService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  const q = parseQuery(sp, listOrderQuery);
  const result = await orderService.listOrders({
    pagination: parsePagination(sp),
    user_id: session.user_id, // บังคับเป็นของตัวเองเสมอ
    order_status: q.order_status,
    payment_status: q.payment_status,
    order_type: q.order_type,
    sort: parseSort(sp, ["created_at", "total_amount", "order_no"], "created_at"),
  });
  return ok(result);
});

export const POST = withAuth(async (session, req) => {
  const body = await parseBody(req, createOrderBody);
  const common = {
    order_type: body.order_type,
    delivery_address: body.delivery_address ?? null,
    promotion_code: body.promotion_code ?? null,
    promotion_id: body.promotion_id ?? null,
    channel: "online" as const,
    // ไม่รับ delivery_fee จากลูกค้า — orderService คิดเอง
  };
  const order =
    body.source === "items"
      ? await orderService.createOrder(session.user_id, { ...common, items: body.items ?? [] })
      : await orderService.createOrderFromCart(session.user_id, {
          ...common,
          item_notes: body.item_notes ?? {},
        });
  audit(req, {
    action: `สั่งซื้อ ${order?.order_no ?? ""}`.trim(),
    action_type: "CREATE",
    entity: "Order",
    entity_id: order?._id ? String(order._id) : null,
    details: { total_amount: order?.total_amount, order_type: order?.order_type },
  });
  return created(order);
});
