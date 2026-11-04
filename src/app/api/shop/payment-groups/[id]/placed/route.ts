/**
 * POST /api/shop/payment-groups/[id]/placed — ลูกค้ากด "ชำระเงินภายหลัง" (สั่งหลายบิลพร้อมกัน — แจ้งทุกบิลในกลุ่ม)
 *   ถึงเวลาแจ้ง "ออเดอร์ใหม่" ให้ร้าน + กระดิ่งลูกค้า (placedNoticeService — แจ้งครั้งเดียว เรียกซ้ำได้)
 *   แนบสลิปก็แจ้งแบบเดียวกันอยู่แล้ว (paymentService) — route นี้สำหรับคนที่ยังไม่โอน
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as paymentGroupService from "@/services/paymentGroupService";
import { announcePlaced } from "@/services/placedNoticeService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const members = await paymentGroupService.groupMembers(id, session.user_id); // ไม่ใช่ของผู้ใช้นี้ = 404
  const results = await Promise.all(members.map((m) => announcePlaced(m.kind, m.id)));
  return ok({ announced: results.filter(Boolean).length });
});
