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
 * BACKLOG §2c.2 — voidTransaction() ย้อนรายการ "receive" เดิมไม่มี floor guard (ต่างจาก
 * createTransaction ฝั่ง "use" ที่มี current_stock: {$gte: qty} ป้องกันสต็อกติดลบอยู่แล้ว)
 * รับของเข้า 100 → เบิกใช้ 80 (เหลือ 20) → void รายการรับ 100 → เดิมได้ -80 เงียบ ๆ
 * เทสนี้ยืนยันว่าตอนนี้ throw conflict แทน และเคส void ปกติ (ยังไม่ได้เบิกใช้) ยังทำงานได้
 */
describe("ingredientTransactionService.voidTransaction — floor guard (BACKLOG 2c.2)", () => {
  it("void รายการ receive หลังถูกเบิกใช้ไปแล้วจนสต็อกไม่พอย้อน → conflict, current_stock ไม่ติดลบ", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 0 });

    const receive = await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "receive",
      qty: 100,
      performed_by: String(user._id),
    });
    await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "use",
      qty: 80,
      performed_by: String(user._id),
    });
    expect((await currentStock(ingredient._id))).toBe(20);

    await expect(
      ingredientTransactionService.voidTransaction(String(receive.transaction._id))
    ).rejects.toThrow(/สต็อกไม่พอให้ย้อน/);

    // สต็อกไม่เปลี่ยน ไม่ติดลบ
    expect((await currentStock(ingredient._id))).toBe(20);
  });

  it("void รายการ receive ที่ยังไม่ถูกเบิกใช้ → สำเร็จ, สต็อกกลับเป็น 0", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 0 });

    const receive = await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "receive",
      qty: 50,
      performed_by: String(user._id),
    });
    expect((await currentStock(ingredient._id))).toBe(50);

    await ingredientTransactionService.voidTransaction(String(receive.transaction._id));

    expect((await currentStock(ingredient._id))).toBe(0);
  });

  it("void รายการ use → คืนสต็อกกลับเสมอ (ทิศทางนี้ไม่มีทางติดลบ ไม่ต้องกัน)", async () => {
    const user = await makeUser();
    const ingredient = await makeIngredient({ current_stock: 30 });

    const use = await ingredientTransactionService.createTransaction({
      ingredient_id: String(ingredient._id),
      type: "use",
      qty: 10,
      performed_by: String(user._id),
    });
    expect((await currentStock(ingredient._id))).toBe(20);

    await ingredientTransactionService.voidTransaction(String(use.transaction._id));

    expect((await currentStock(ingredient._id))).toBe(30);
  });
});
