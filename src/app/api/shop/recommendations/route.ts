/**
 * GET /api/shop/recommendations — สินค้าแนะนำเฉพาะตัว (ต้องล็อกอิน · customer-backend-merge.md §8.15)
 *   ?limit= (1–50 · ค่าเริ่มต้น 10) · ?strategy=hybrid|collaborative|content|popular · ?excludeAllergens=true (ตัดสินค้าที่แพ้ออก)
 *   → { recommendations: [{ product, score, reasons, allergenWarning }], meta } · คำนวณเกิน 4.5 วิ = ถอยเป็น popular
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as recommendationService from "@/services/recommendation/recommendationService";

export const GET = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(
    await recommendationService.personalized({
      userId: session.user_id,
      limit: recommendationService.clampLimit(sp.get("limit"), 10, 50),
      strategy: recommendationService.parseStrategy(sp.get("strategy")),
      excludeAllergens: sp.get("excludeAllergens") === "true",
    })
  );
});
