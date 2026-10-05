/**
 * GET /api/shop/points — แต้มสะสมของฉัน: ยอด · แต้มใกล้หมดอายุ (30 วัน) · ประวัติ 50 รายการ · สถานะโบนัส · กติกา
 * ตัดแต้มหมดอายุ + เช็คโบนัสข้อมูลครบก่อนอ่านยอด — pointsService (customer-backend-merge.md §8.11)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as pointsService from "@/services/pointsService";

export const GET = withAuth(async (session) => ok(await pointsService.getMyPoints(session.user_id)));
