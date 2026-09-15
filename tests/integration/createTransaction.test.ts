import { describe, it, expect } from "vitest";
import ingredientModel from "@/models/ingredientModel";
import * as ingredientTransactionService from "@/services/ingredientTransactionService";
import { makeUser, makeIngredient } from "./helpers";

async function currentStock(ingredientId: unknown): Promise<number> {
  const doc = await ingredientModel
    .findById(ingredientId)
    .lean<{ current_stock: number } | null>();
  return doc!.current_stock;
}

/**
 * BACKLOG §3.4 — integration tests เพิ่ม: ingredientTransactionService.createTransaction
 * (voidTransaction.test.ts คุม voidTransaction ไปแล้ว — ไฟล์นี้คุม createTransaction เอง)
 */
describe("ingredientTransactionService.createTransaction — receive/use/adjust", () => {
  it("type=receive → เพิ่ม current_stock ตาม qty, บันทึก before/after ถูกต้อง", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 10 });

    const result = await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "receive",
      qty: 25,
      performed_by: String(user._id),
    });

    expect(result.stock).toEqual({ ingredient_id: String(ingredient._id), before: 10, after: 35 });
    expect(await currentStock(ingredient._id)).toBe(35);
  });

  it("type=use พอสต็อก → ลด current_stock ตาม qty", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 20 });

    const result = await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "use",
      qty: 8,
      performed_by: String(user._id),
    });

    expect(result.stock.after).toBe(12);
    expect(await currentStock(ingredient._id)).toBe(12);
  });

  it("type=use ไม่พอสต็อก → conflict, current_stock ไม่เปลี่ยน", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 5 });

    await expect(
      ingredientTransactionService.createTransaction({
        ingredient_id: String(ingredient._id),
        type: "use",
        qty: 10,
        performed_by: String(user._id),
      })
    ).rejects.toThrow(/สต็อกวัตถุดิบไม่พอ/);

    expect(await currentStock(ingredient._id)).toBe(5);
  });

  it("type=use ไม่พอสต็อก แต่ allowNegative=true → ผ่าน ติดลบได้", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 5 });

    const result = await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "use",
      qty: 10,
      performed_by: String(user._id),
      allowNegative: true,
    });

    expect(result.stock.after).toBe(-5);
    expect(await currentStock(ingredient._id)).toBe(-5);
  });

  it("type=adjust → ตั้งยอดนับจริงตรง ๆ (ไม่ใช่ inc/dec) + note บันทึกส่วนต่าง", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 40 });

    const result = await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "adjust",
      qty: 33,
      performed_by: String(user._id),
    });

    expect(result.stock).toEqual({ ingredient_id: String(ingredient._id), before: 40, after: 33 });
    expect(await currentStock(ingredient._id)).toBe(33);
    expect(result.transaction.note).toMatch(/40 → 33/);
  });

  it("type นอก enum → badRequest", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient();

    await expect(
      ingredientTransactionService.createTransaction({
        ingredient_id: String(ingredient._id),
        // @ts-expect-error ทดสอบค่าที่ไม่ถูก enum โดยตั้งใจ
        type: "restock",
        qty: 1,
        performed_by: String(user._id),
      })
    ).rejects.toThrow();
  });

  it('type="use"/"receive" ที่ qty <= 0 → badRequest', async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient();

    await expect(
      ingredientTransactionService.createTransaction({
        ingredient_id: String(ingredient._id),
        type: "use",
        qty: 0,
        performed_by: String(user._id),
      })
    ).rejects.toThrow();
  });
});

describe("ingredientTransactionService.voidTransaction — adjust type", () => {
  it("void รายการ type=adjust → badRequest (ไม่มียอดก่อนหน้าให้ย้อน)", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 10 });

    const result = await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "adjust",
      qty: 7,
      performed_by: String(user._id),
    });

    await expect(
      ingredientTransactionService.voidTransaction(String(result.transaction._id))
    ).rejects.toThrow(/adjust ยกเลิกไม่ได้/);
  });
});
