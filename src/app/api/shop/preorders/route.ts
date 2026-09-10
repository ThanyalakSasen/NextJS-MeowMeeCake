/**
 * /api/shop/preorders  (พรีออเดอร์ของผู้ใช้ที่ล็อกอินเท่านั้น)
 *   GET  — รายการพรีออเดอร์ของตัวเอง (?order_status=&payment_status=&order_type=&round_id=&page=&limit=)
 *   POST — สั่งพรีออเดอร์ของตัวเอง
 *          body: { round_id, order_type: "delivery"|"takeaway", delivery_address?,
 *                  items: [{ round_item_id, quantity, special_request? }] }
 *          - ค่าส่งคิดฝั่ง server จากจังหวัด + ยอดสั่งซื้อ ; ส่วนลดกรอกเองไม่ได้
 */
import { ok, created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parsePagination, parseSort } from "@/lib/queryParams";
import * as preorderService from "@/services/preorderService";
import type { PreorderStatus, PaymentStatus } from "@/services/preorderService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await preorderService.listPreorders({
    pagination: parsePagination(sp),
    user_id: session.user_id, // บังคับเป็นของตัวเองเสมอ
    round_id: sp.get("round_id") ?? undefined,
    order_status: (sp.get("order_status") as PreorderStatus | null) ?? undefined,
    payment_status: (sp.get("payment_status") as PaymentStatus | null) ?? undefined,
    order_type: (sp.get("order_type") as "delivery" | "takeaway" | null) ?? undefined,
    sort: parseSort(sp, ["created_at", "total_amount", "preorder_no"], "created_at"),
  });
  return ok(result);
});

export const POST = withAuth(async (session, req) => {
  const body = await req.json();
  const preorder: any = await preorderService.createPreorder(session.user_id, {
    round_id: body.round_id,
    order_type: body.order_type,
    delivery_address: body.delivery_address ?? null,
    items: body.items ?? [],
  });
  audit(req, {
    action: `สั่งพรีออเดอร์ ${preorder?.preorder_no ?? ""}`.trim(),
    action_type: "CREATE",
    entity: "Preorder",
    entity_id: preorder?._id ? String(preorder._id) : null,
    details: { round_id: body.round_id, total_amount: preorder?.total_amount, order_type: preorder?.order_type },
  });
  return created(preorder);
});
