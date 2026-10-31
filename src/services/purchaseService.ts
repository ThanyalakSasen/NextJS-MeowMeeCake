/**
 * purchaseService — บันทึกการซื้อวัตถุดิบ: รับเข้าสต็อก + ค่าใช้จ่าย 1 ใบ ผูกถึงกัน (ผู้ใช้ขอ 2026-10-31)
 *
 *   createPurchase()  → ค่าใช้จ่าย 1 ใบ (ยอด = ผลรวมราคาทุกรายการ) + รายการรับเข้าสต็อก 1 แถวต่อวัตถุดิบ
 *                       แต่ละแถวเก็บ expense_id + line_total → ดูได้ว่าบิลนี้ซื้ออะไร กี่หน่วย ราคาเท่าไร
 *   listStockItems()  → รายการรับเข้าที่ผูกกับค่าใช้จ่ายใบนั้น
 *   linkStockItems()  → ผูกรายการรับเข้าเดิม (บันทึกก่อนมีฟีเจอร์นี้) กับค่าใช้จ่ายย้อนหลัง
 *   unlinkStockItem() → ยกเลิกการผูก (สต็อกไม่เปลี่ยน)
 *
 * ความจริงอยู่ที่รายการรับเข้า (IngredientTransactions.expense_id/line_total) ที่เดียว — ค่าใช้จ่ายไม่เก็บรายการซ้ำ
 * ค่าใช้จ่ายที่ผูกอยู่ลบไม่ได้ / รายการรับเข้าที่ผูกอยู่ยกเลิกไม่ได้ (ต้องยกเลิกการผูกก่อน — ยอดเงินกับของจะได้ตรงกันเสมอ)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { isIntegerOnlyUnit } from "../lib/unitRules";
import { log } from "../lib/logger";
import ingredientModel from "../models/ingredientModel";
import ingredientTransactionModel from "../models/ingredientTransactionModel";
import expenseModel from "../models/expenseModel";
import unitModel from "../models/unitModel";
import { EXPENSE_MAX } from "../schemas/expense";
import type { PurchaseCreate } from "../schemas/purchase";
import { createTransaction } from "./ingredientTransactionService";
import { expenseService, linkedStockTotals } from "./expenseService";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESCRIPTION_MAX = 300;
const NOTE_MAX = 200;

/** "ซื้อวัตถุดิบ: แป้ง, เนย, ไข่ และอีก 2 รายการ" — ใช้เมื่อผู้ใช้ไม่ได้กรอกรายละเอียดเอง */
function defaultDescription(category: string, names: string[]): string {
  const head = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` และอีก ${names.length - 3} รายการ` : "";
  return `ซื้อ${category}: ${head}${more}`.slice(0, DESCRIPTION_MAX);
}

// ── CREATE ──────────────────────────────────────────────────
export async function createPurchase(input: PurchaseCreate, performedBy: string) {
  await dbConnect();

  // ตรวจทุกอย่างก่อนเริ่มเขียน — ล้มกลางทางแล้วต้องย้อนทั้งค่าใช้จ่ายและสต็อก
  const ids = [...new Set(input.items.map((i) => i.ingredient_id))];
  const ingredients = await ingredientModel
    .find({ _id: { $in: ids }, deleted_at: null })
    .select("ingredient_name unit_id")
    .lean<any[]>();
  const byId = new Map(ingredients.map((g) => [String(g._id), g]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) throw notFound("ไม่พบวัตถุดิบบางรายการ (อาจถูกลบไปแล้ว) — โหลดหน้าใหม่แล้วลองอีกครั้ง");

  const units = await unitModel
    .find({ _id: { $in: ingredients.map((g) => g.unit_id) } })
    .select("unit_type unit_name unit_abbr")
    .lean<any[]>();
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  for (const item of input.items) {
    const g = byId.get(item.ingredient_id);
    const unit = unitById.get(String(g.unit_id));
    if (!Number.isInteger(item.qty) && isIntegerOnlyUnit(unit)) {
      throw badRequest(`"${g.ingredient_name}" หน่วย "${unit?.unit_abbr || unit?.unit_name}" ต้องกรอกเป็นจำนวนเต็ม`);
    }
  }

  const amount = input.items.reduce((s, i) => s + i.line_total, 0);
  if (amount <= 0) throw badRequest("ยอดรวมของบิลต้องมากกว่า 0 บาท");
  if (amount > EXPENSE_MAX) throw badRequest(`ยอดรวมของบิลต้องไม่เกิน ${EXPENSE_MAX.toLocaleString("en-US")} บาท`);

  const description =
    input.description?.trim() ||
    defaultDescription(input.category, input.items.map((i) => byId.get(i.ingredient_id).ingredient_name));

  const expense: any = await expenseService.create({
    date: input.date,
    description,
    category: input.category,
    amount,
    payment_method: input.payment_method,
    vendor: input.vendor ?? "",
    note: input.note ?? "",
    receipt_url: input.receipt_url ?? null,
    is_recurring: false,
  });

  const created: { _id: unknown; ingredient_id: unknown; qty: number }[] = [];
  try {
    for (const item of input.items) {
      const g = byId.get(item.ingredient_id);
      const { transaction } = await createTransaction({
        ingredient_id: item.ingredient_id,
        type: "receive",
        qty: item.qty,
        unit_id: String(g.unit_id),
        note: `บิลซื้อ: ${description}`.slice(0, NOTE_MAX),
        po_ref: input.po_ref || null,
        transaction_date: input.date,
        expiry_date: item.expiry_date ?? null,
        performed_by: performedBy,
        expense_id: String(expense._id),
        line_total: item.line_total,
      });
      created.push(transaction as any);
    }
  } catch (err) {
    // ย้อนสิ่งที่เขียนไปแล้ว (best-effort) — สต็อกที่บวกเข้า + รายการรับเข้า + ค่าใช้จ่าย
    for (const t of created) {
      await ingredientModel.updateOne({ _id: t.ingredient_id }, { $inc: { current_stock: -t.qty } }).catch(() => undefined);
      await ingredientTransactionModel.deleteOne({ _id: t._id }).catch(() => undefined);
    }
    await expenseModel.deleteOne({ _id: expense._id }).catch((e: unknown) => log.error("purchase.rollback_failed", { expense_id: String(expense._id), err: e }));
    throw err;
  }

  return { expense: { ...expense, linked_count: created.length, linked_total: amount }, transactions: created };
}

// ── READ ────────────────────────────────────────────────────
async function activeExpense(expenseId: string) {
  assertObjectId(expenseId);
  const expense = await expenseModel.findOne({ _id: expenseId, deleted_at: null }).lean<any>();
  if (!expense) throw notFound("ไม่พบค่าใช้จ่ายที่ระบุ");
  return expense;
}

export async function listStockItems(expenseId: string) {
  await dbConnect();
  await activeExpense(expenseId);
  return ingredientTransactionModel
    .find({ expense_id: expenseId, deleted_at: null })
    .sort({ transaction_date: 1, created_at: 1 })
    .populate("ingredient_id", "ingredient_name")
    .populate("unit_id", "unit_name unit_abbr")
    .lean();
}

// ── LINK / UNLINK (ผูกย้อนหลัง) ────────────────────────────
export async function linkStockItems(expenseId: string, links: { transaction_id: string; line_total: number }[]) {
  await dbConnect();
  const expense = await activeExpense(expenseId);

  const ids = links.map((l) => l.transaction_id);
  if (new Set(ids).size !== ids.length) throw badRequest("มีรายการรับเข้าซ้ำกัน");
  const txns = await ingredientTransactionModel
    .find({ _id: { $in: ids }, deleted_at: null })
    .select("type expense_id")
    .lean<any[]>();
  if (txns.length !== ids.length) throw notFound("ไม่พบรายการรับเข้าบางรายการ (อาจถูกยกเลิกไปแล้ว)");
  if (txns.some((t) => t.type !== "receive")) throw badRequest("ผูกกับค่าใช้จ่ายได้เฉพาะรายการรับเข้า");
  if (txns.some((t) => t.expense_id)) throw conflict("มีรายการรับเข้าที่ผูกกับค่าใช้จ่ายอื่นอยู่แล้ว");

  // ยอดของที่ผูกรวมต้องไม่เกินยอดค่าใช้จ่าย (บิลอาจมีของที่ไม่เข้าสต็อกด้วย จึงน้อยกว่าได้)
  const current = (await linkedStockTotals([expenseId])).get(expenseId)?.total ?? 0;
  const adding = links.reduce((s, l) => s + l.line_total, 0);
  if (current + adding > expense.amount) {
    throw badRequest(`ราคารวมของรายการที่ผูก (${current + adding} บาท) เกินยอดค่าใช้จ่ายนี้ (${expense.amount} บาท)`);
  }

  let linked = 0;
  for (const l of links) {
    // เงื่อนไข expense_id: null กันผูกซ้ำพร้อมกันจากสองหน้าจอ
    const res = await ingredientTransactionModel.updateOne(
      { _id: l.transaction_id, expense_id: null, deleted_at: null },
      { $set: { expense_id: expense._id, line_total: l.line_total } }
    );
    linked += res.modifiedCount;
  }
  return { linked };
}

export async function unlinkStockItem(expenseId: string, transactionId: string) {
  await dbConnect();
  await activeExpense(expenseId);
  assertObjectId(transactionId, "transaction_id");
  const res = await ingredientTransactionModel.updateOne(
    { _id: transactionId, expense_id: expenseId },
    { $set: { expense_id: null, line_total: null } }
  );
  if (res.modifiedCount === 0) throw notFound("ไม่พบรายการรับเข้านี้ในค่าใช้จ่ายที่ระบุ");
  return { unlinked: 1 };
}
