/** POST /api/admin/expenses/[id]/restore — reports.update */
import { restoreRoute } from "@/lib/crudRoutes";
import { expenseService } from "@/services/expenseService";

export const { POST } = restoreRoute(expenseService, {
  auth: { menu: "reports" },
  audit: { entity: "Expense" },
});
