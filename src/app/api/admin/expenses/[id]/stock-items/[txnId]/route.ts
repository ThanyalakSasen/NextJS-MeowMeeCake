/**
 * DELETE /api/admin/expenses/[id]/stock-items/[txnId] — ยกเลิกการผูกรายการรับเข้ากับค่าใช้จ่าย (finance_expenses.update)
 *   สต็อกไม่เปลี่ยน — แค่ปลดการอ้างอิง (หลังปลดแล้วรายการรับเข้ายกเลิกได้ / ค่าใช้จ่ายลบได้)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { unlinkStockItem } from "@/services/purchaseService";
import { expenseService } from "@/services/expenseService";

type Ctx = { params: Promise<{ id: string; txnId: string }> };

export const DELETE = withPermission("finance_expenses", "update", async (_s, req, ctx: Ctx) => {
  const { id, txnId } = await ctx.params;
  const result = await unlinkStockItem(id, txnId);
  const expense = (await expenseService.getById(id).catch(() => undefined)) as { description?: string } | undefined;
  auditChange(req, {
    op: "update",
    verb: "ยกเลิกการผูกรายการรับเข้าสต็อกกับ",
    noun: "ค่าใช้จ่าย",
    label: expense?.description,
    entity: "Expense",
    entity_id: id,
    details: { transaction_id: txnId },
  });
  return ok(result);
});
