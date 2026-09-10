/** GET /api/admin/expenses/summary — สรุปค่าใช้จ่ายตามหมวด (reports.view) ?date_from= ?date_to= */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as expenseService from "@/services/expenseService";

export const GET = withPermission("reports", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  return ok(
    await expenseService.summary({
      date_from: sp.get("date_from") ?? undefined,
      date_to: sp.get("date_to") ?? undefined,
    })
  );
});
