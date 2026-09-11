/** /api/admin/expenses/[id] — GET/PATCH/DELETE (reports) */
import { itemRoutes } from "@/lib/crudRoutes";
import { expenseUpdate } from "@/schemas/expense";
import { expenseService } from "@/services/expenseService";

export const { GET, PATCH, DELETE } = itemRoutes(expenseService, {
  auth: { menu: "reports" },
  audit: { entity: "Expense" },
  validate: { update: expenseUpdate },
});
