/**
 * POST /api/admin/purchases — บันทึกการซื้อวัตถุดิบ: รับเข้าสต็อกทุกรายการ + ค่าใช้จ่าย 1 ใบ ผูกถึงกัน
 *   สิทธิ์: finance_expenses.create (สร้างค่าใช้จ่าย) และ ingredient_stock.update (รับเข้าสต็อก) ทั้งคู่
 *   body: { date, vendor?, category: "วัตถุดิบ"|"บรรจุภัณฑ์", payment_method, description?, note?, receipt_url?, po_ref?,
 *           items: [{ ingredient_id, qty, line_total, expiry_date? }] } — ดู services/purchaseService.ts
 */
import { created } from "@/lib/apiResponse";
import { requirePermission, withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBody } from "@/lib/validate";
import { purchaseCreate } from "@/schemas/purchase";
import { createPurchase } from "@/services/purchaseService";

export const POST = withPermission("finance_expenses", "create", async (session, req) => {
  await requirePermission(session, "ingredient_stock", "update");
  const body = await parseBody(req, purchaseCreate);
  const result = await createPurchase(body, session.user_id);
  auditChange(req, {
    op: "create",
    verb: "บันทึกการซื้อ",
    noun: "",
    label: String(result.expense.description ?? ""),
    suffix: ` (${result.transactions.length} รายการ รวม ${result.expense.amount} บาท)`,
    entity: "Expense",
    entity_id: String(result.expense._id),
    after: result.expense,
    details: { items: body.items, vendor: body.vendor ?? "" },
  });
  return created(result);
});
