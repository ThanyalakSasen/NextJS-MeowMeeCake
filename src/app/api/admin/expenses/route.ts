/**
 * /api/admin/expenses
 *   GET  — รายการค่าใช้จ่าย (reports.view) ?search= ?category= ?is_recurring= ?date_from= ?date_to=
 *   POST — บันทึกค่าใช้จ่าย (reports.create)
 *          body: { date, description, category, amount, payment_method, vendor?, note?, receipt_url?, is_recurring? }
 */
import { collectionRoutes } from "@/lib/crudRoutes";
import { parseBool } from "@/lib/queryParams";
import { expenseCreate } from "@/schemas/expense";
import { expenseService } from "@/services/expenseService";

export const { GET, POST } = collectionRoutes(expenseService, {
  sortable: ["date", "amount", "created_at"],
  defaultSort: "date",
  filterFromQuery: (sp) => {
    const filter: Record<string, unknown> = {
      category: sp.get("category") ?? undefined,
      is_recurring: parseBool(sp.get("is_recurring")),
    };
    const from = sp.get("date_from");
    const to = sp.get("date_to");
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = new Date(from);
      if (to) range.$lte = new Date(to);
      filter.date = range;
    }
    return filter;
  },
  auth: { menu: "reports" },
  audit: { entity: "Expense" },
  validate: { create: expenseCreate },
});
