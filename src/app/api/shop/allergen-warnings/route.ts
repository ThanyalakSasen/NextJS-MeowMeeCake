/**
 * GET /api/shop/allergen-warnings — คำเตือนสารก่อภูมิแพ้ของสินค้าทุกชิ้นตามอาหารที่ลูกค้าบันทึกไว้ (ต้องล็อกอิน)
 *   → { warnings: { [product _id]: { level, message, matchedAllergens, scoreAdjustment } } }
 *   มีเฉพาะสินค้าที่ต้องเตือน · ไม่ได้บันทึกอาหารที่แพ้ = {} · การ์ดสินค้าทุกหน้าใช้แสดงป้ายเตือน
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as recommendationService from "@/services/recommendation/recommendationService";

export const GET = withAuth(async (session) => ok(await recommendationService.allergenWarnings(session.user_id)));
