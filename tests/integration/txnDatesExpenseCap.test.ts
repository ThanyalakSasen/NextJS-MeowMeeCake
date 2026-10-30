import { describe, it, expect } from "vitest";
import * as txnService from "@/services/ingredientTransactionService";
import { expenseCreate, expenseUpdate, EXPENSE_MAX } from "@/schemas/expense";
import { makeUser, makeIngredient } from "./helpers";

/** รายการวัตถุดิบ: วันที่ต้องแปลงได้ · หมายเหตุ ≤ 200 · po_ref ≤ 100 — ค่าใช้จ่าย: ยอด ≤ EXPENSE_MAX */

describe("รายการวัตถุดิบ", () => {
  it("วันที่ผิดรูปแบบ / หมายเหตุหรือ po_ref ยาวเกิน → 400 · ค่าปกติผ่าน", async () => {
    const ing = await makeIngredient();
    const user = await makeUser();
    const base = { ingredient_id: String(ing._id), type: "receive" as const, qty: 1, performed_by: String(user._id) };
    await expect(txnService.createTransaction({ ...base, transaction_date: "abc" })).rejects.toMatchObject({ status: 400 });
    await expect(txnService.createTransaction({ ...base, expiry_date: "2026-13-45" })).rejects.toMatchObject({ status: 400 });
    await expect(txnService.createTransaction({ ...base, note: "ก".repeat(201) })).rejects.toMatchObject({ status: 400 });
    await expect(txnService.createTransaction({ ...base, po_ref: "x".repeat(101) })).rejects.toMatchObject({ status: 400 });
    await txnService.createTransaction({ ...base, transaction_date: "2026-10-30", expiry_date: "", note: "ก".repeat(200), po_ref: "PO-1" });
  });
});

describe("ค่าใช้จ่าย", () => {
  const body = { date: "2026-10-30", description: "ค่าแป้ง", category: "อื่นๆ", payment_method: "เงินสด" };
  it("ยอดเกินเพดาน → ไม่ผ่าน schema · พอดีเพดานผ่าน", () => {
    expect(expenseCreate.safeParse({ ...body, amount: EXPENSE_MAX + 1 }).success).toBe(false);
    expect(expenseUpdate.safeParse({ amount: EXPENSE_MAX + 1 }).success).toBe(false);
    expect(expenseCreate.safeParse({ ...body, amount: EXPENSE_MAX }).success).toBe(true);
  });
});
