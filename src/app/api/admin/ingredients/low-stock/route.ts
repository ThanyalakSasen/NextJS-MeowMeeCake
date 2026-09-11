/** GET /api/admin/ingredients/low-stock — วัตถุดิบที่ถึงจุดสั่งซื้อ (ingredients.view) ?limit= */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { parseNumber } from "@/lib/queryParams";
import { ingredientService } from "@/services/ingredientService";

export const GET = withPermission("ingredients", "view", async (_s, req) => {
  const limit = parseNumber(req.nextUrl.searchParams.get("limit"));
  return ok(await ingredientService.getLowStock({ limit }));
});
