/**
 * GET /api/catalog/ingredients — รายชื่อวัตถุดิบ (สาธารณะ) ให้ลูกค้าเลือกอาหารที่แพ้ (users.user_allergies — PATCH /api/shop/me)
 *   → { ingredients: [{ _id, ingredient_name }] } · ไม่ส่งต้นทุน/ผู้ขาย/สต็อก (customer-backend-merge.md §8.15)
 */
import { ok, route } from "@/lib/apiResponse";
import * as recommendationService from "@/services/recommendation/recommendationService";

export const GET = route(async () => ok(await recommendationService.publicIngredients()));
