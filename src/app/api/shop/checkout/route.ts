/**
 * POST /api/shop/checkout — สั่งซื้อรวมครั้งเดียว (ตะกร้ารวม: สินค้าปกติ + พรีออเดอร์หลายรอบ · services/checkoutService)
 *   body: { order?: <เหมือน POST /api/shop/orders · source "cart">, preorders?: [<เหมือน POST /api/shop/preorders>] }
 *   - แต่ละบิลเลือกวิธีรับ/ที่อยู่/จุดรับของตัวเอง · ค่าส่งคิดต่อบิล · คูปอง/โค้ดใช้ได้กับบิลเดียว
 *   - ใบไหนสร้างไม่ผ่าน = ยกเลิกใบที่สร้างไปแล้ว (ตะกร้ายังอยู่) แล้วตอบ error ของใบนั้น
 *   → 201 { group_id | null, bills: [{ kind, _id, doc_no, total_amount }] }
 *     group_id มีเมื่อได้มากกว่า 1 บิล — ชำระรวมที่ /api/shop/payment-groups/{group_id}
 */
import { created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/validate";
import { checkoutBody } from "@/schemas/checkout";
import * as checkoutService from "@/services/checkoutService";

export const POST = withAuth(async (session, req) => {
  const body = await parseBody(req, checkoutBody);
  // กันกดรัว/สคริปต์ (สร้างหลายบิลต่อคำขอ)
  await rateLimit(session.user_id, "shop:checkout", { limit: 10, windowMs: 60_000 });
  const result = await checkoutService.checkout(session.user_id, body);
  audit(req, {
    action: `สั่งซื้อรวม ${result.bills.map((b) => b.doc_no).join(", ")}`,
    action_type: "CREATE",
    entity: result.bills[0]?.kind === "preorder" ? "Preorder" : "Order",
    entity_id: result.bills[0]?._id ?? null,
    details: { group_id: result.group_id, bills: result.bills },
  });
  return created(result);
});
