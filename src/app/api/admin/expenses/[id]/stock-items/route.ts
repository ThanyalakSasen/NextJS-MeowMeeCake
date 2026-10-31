/**
 * /api/admin/expenses/[id]/stock-items — รายการรับเข้าสต็อกวัตถุดิบที่ผูกกับค่าใช้จ่ายใบนี้ (services/purchaseService)
 *   GET  — รายการที่ผูกอยู่ (finance_expenses/finance_summary.view)
 *   POST — ผูกรายการรับเข้าเดิมย้อนหลัง (finance_expenses.update) body: { links: [{ transaction_id, line_total }], update_cost? }
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { expenseLinkBody } from "@/schemas/purchase";
import { linkStockItems, listStockItems } from "@/services/purchaseService";
import { expenseService } from "@/services/expenseService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission(["finance_expenses", "finance_summary"], "view", async (_s, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await listStockItems(id));
});

export const POST = withPermission("finance_expenses", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, expenseLinkBody);
  const result = await linkStockItems(id, body.links, { update_cost: body.update_cost });
  const expense = (await expenseService.getById(id).catch(() => undefined)) as { description?: string } | undefined;
  auditChange(req, {
    op: "update",
    verb: "ผูกรายการรับเข้าสต็อกกับ",
    noun: "ค่าใช้จ่าย",
    label: expense?.description,
    suffix: ` (${result.linked} รายการ)`,
    entity: "Expense",
    entity_id: id,
    details: { links: body.links },
  });
  return ok(result);
});
