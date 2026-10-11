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
import { ingredientService } from "@/services/ingredientService";

const TXN_VERB: Record<TransactionType, string> = { receive: "รับ", use: "เบิก", adjust: "ปรับยอด" };

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
  // ชื่อวัตถุดิบ + หน่วย ไว้ใส่ข้อความ log — อ่านไม่ได้ก็ยัง log ได้ (ไม่มีชื่อ)
  const ingredient: any = await ingredientService.getById(String(body.ingredient_id), true).catch(() => null);
  const name = ingredient?.ingredient_name ? ` "${ingredient.ingredient_name}"` : "";
  const unit = ingredient?.unit_id?.unit_abbr || ingredient?.unit_id?.unit_name || "";
  const { before, after } = result.stock as { before: number; after: number };
  const delta = after - before;
  const signed = `${delta >= 0 ? "+" : ""}${delta}`;
  audit(req, {
    action: `${TXN_VERB[body.type as TransactionType] ?? "ปรับสต็อก"}วัตถุดิบ${name} ${signed}${unit ? ` ${unit}` : ""} (${before} → ${after})`,
    action_type: "CREATE",
    entity: "IngredientTransaction",
    entity_id: result?.transaction?._id ? String(result.transaction._id) : null,
    details: { ingredient_id: body.ingredient_id, type: body.type, qty: Number(body.qty), change: delta, unit },
    before: { current_stock: before },
    after: { current_stock: after },
  });
  return created(result);
});
