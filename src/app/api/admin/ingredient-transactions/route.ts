/**
 * /api/admin/ingredient-transactions
 *   GET  — รายการเคลื่อนไหวสต็อกวัตถุดิบ (ingredients.view)
 *   POST — บันทึกการเคลื่อนไหว + ปรับ current_stock (ingredients.update) — performed_by = ผู้ทำรายการ
 *          body: { ingredient_id, type: "use"|"receive"|"adjust", qty,
 *                  unit_id?, note?, po_ref?, transaction_date?, expiry_date?, allowNegative? }
 */
import { ok, created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { parseBool, parsePagination } from "@/lib/queryParams";
import * as txnService from "@/services/ingredientTransactionService";
import type { TransactionType } from "@/services/ingredientTransactionService";

export const GET = withPermission("ingredients", "view", async (_s, req) => {
  const sp = req.nextUrl.searchParams;
  const result = await txnService.listTransactions({
    pagination: parsePagination(sp),
    ingredient_id: sp.get("ingredient_id") ?? undefined,
    type: (sp.get("type") as TransactionType | null) ?? undefined,
    performed_by: sp.get("performed_by") ?? undefined,
    date_from: sp.get("date_from") ?? undefined,
    date_to: sp.get("date_to") ?? undefined,
    includeDeleted: parseBool(sp.get("includeDeleted")) ?? false,
  });
  return ok(result);
});

export const POST = withPermission("ingredients", "update", async (session, req) => {
  const body = await req.json();
  const result: any = await txnService.createTransaction({
    ...body,
    performed_by: session.user_id,
  });
  audit(req, {
    action: `เคลื่อนไหวสต็อกวัตถุดิบ (${body.type}) จำนวน ${body.qty}`,
    action_type: "CREATE",
    entity: "IngredientTransaction",
    entity_id: result?.transaction?._id ? String(result.transaction._id) : null,
    details: { ingredient_id: body.ingredient_id, type: body.type, qty: body.qty },
  });
  return created(result);
});
