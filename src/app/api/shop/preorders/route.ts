/**
 * /api/shop/preorders  (พรีออเดอร์ของผู้ใช้ที่ล็อกอินเท่านั้น)
 *   GET  — รายการพรีออเดอร์ของตัวเอง (?order_status=&payment_status=&order_type=&round_id=&page=&limit=)
 *   POST — สั่งพรีออเดอร์ของตัวเอง — ตรวจ body ด้วย schemas/preorder.createPreorderBody
 *          body: { round_id, order_type: "delivery"|"takeaway",
 *                  address_id? (จากสมุดที่อยู่ + recipient_name/recipient_phone) | delivery_address? (กรอกใหม่ทั้งก้อน),
 *                  items: [{ round_item_id, quantity, special_request? }] }
 *          - ที่อยู่จัดส่ง: ระบุ address_id หรือ delivery_address อย่างใดอย่างหนึ่งเท่านั้น (BACKLOG §3.8)
 *          - ค่าส่งคิดฝั่ง server จากจังหวัด + ยอดสั่งซื้อ ; ส่วนลดกรอกเองไม่ได้
 */
import { ok, created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parsePagination, parseSort } from "@/lib/queryParams";
import { parseBody, parseQuery } from "@/lib/validate";
import { createPreorderBody, listPreorderQuery } from "@/schemas/preorder";
import * as preorderService from "@/services/preorderService";
import * as addressService from "@/services/addressService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  const q = parseQuery(sp, listPreorderQuery);
  const result = await preorderService.listPreorders({
    pagination: parsePagination(sp),
    user_id: session.user_id, // บังคับเป็นของตัวเองเสมอ
    round_id: q.round_id,
    order_status: q.order_status,
    payment_status: q.payment_status,
    order_type: q.order_type,
    sort: parseSort(sp, ["created_at", "total_amount", "preorder_no"], "created_at"),
  });
  return ok(result);
});

export const POST = withAuth(async (session, req) => {
  const body = await parseBody(req, createPreorderBody);
  const delivery_address = await addressService.resolveDeliverySnapshot(session.user_id, body);
  const preorder = await preorderService.createPreorder(session.user_id, {
    round_id: body.round_id,
    order_type: body.order_type,
    delivery_address,
    items: body.items,
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
