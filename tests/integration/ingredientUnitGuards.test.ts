import { describe, it, expect } from "vitest";
import recipeModel from "@/models/recipeModel";
import ingredientModel from "@/models/ingredientModel";
import { ingredientService } from "@/services/ingredientService";
import * as txnService from "@/services/ingredientTransactionService";
import { makeUser, makeUnit, makeIngredient, makeProduct, makeRecipe } from "./helpers";

/** ระบบไม่แปลงหน่วย — กันตัวเลขถูกตีความผิดหน่วย: เปลี่ยนหน่วยวัตถุดิบ · ทำรายการด้วยหน่วยอื่น */

describe("เปลี่ยนหน่วยของวัตถุดิบ", () => {
  it("ยังมีสต็อก → 409 · สต็อก 0 และไม่มีสูตรใช้ → เปลี่ยนได้", async () => {
    const ing = await makeIngredient({ current_stock: 500 });
    const other = await makeUnit();
    await expect(ingredientService.update(String(ing._id), { unit_id: String(other._id) })).rejects.toMatchObject({ status: 409 });

    await ingredientModel.updateOne({ _id: ing._id }, { $set: { current_stock: 0 } });
    await ingredientService.update(String(ing._id), { unit_id: String(other._id) });
    const after = await ingredientModel.findById(ing._id).lean<{ unit_id: unknown }>();
    expect(String(after?.unit_id)).toBe(String(other._id));
  });

  it("มีสูตรใช้อยู่ → 409 · ส่งหน่วยเดิมกลับมา (แก้ฟิลด์อื่น) ผ่าน", async () => {
    const ing = await makeIngredient();
    const product = await makeProduct();
    await makeRecipe(String(product._id), { ingredients: [{ ingredient_id: ing._id, quantity: 100, unit_id: ing.unit_id }] });
    const other = await makeUnit();
    await expect(ingredientService.update(String(ing._id), { unit_id: String(other._id) })).rejects.toMatchObject({ status: 409 });
    await expect(ingredientService.update(String(ing._id), { unit_id: String(ing.unit_id), supplier: "ร้านใหม่" })).resolves.toBeTruthy();
  });
});

describe("ลบวัตถุดิบ", () => {
  it("สูตรใช้อยู่ → 409 และยังไม่ถูกลบ · ไม่มีสูตรใช้ / สูตรถูกลบแล้ว → ลบได้", async () => {
    const ing = await makeIngredient();
    const product = await makeProduct();
    const recipe = await makeRecipe(String(product._id), { ingredients: [{ ingredient_id: ing._id, quantity: 100, unit_id: ing.unit_id }] });
    await expect(ingredientService.remove(String(ing._id))).rejects.toMatchObject({ status: 409 });
    expect((await ingredientModel.findById(ing._id).lean<{ deleted_at: Date | null }>())?.deleted_at).toBeNull();

    await recipeModel.updateOne({ _id: recipe._id }, { $set: { deleted_at: new Date() } });
    await ingredientService.remove(String(ing._id));
    expect((await ingredientModel.findById(ing._id).lean<{ deleted_at: Date | null }>())?.deleted_at).not.toBeNull();

    const unused = await makeIngredient();
    await expect(ingredientService.remove(String(unused._id))).resolves.toBeTruthy();
  });
});

describe("ทำรายการวัตถุดิบด้วยมือ", () => {
  it("unit_id ไม่ตรงหน่วยของวัตถุดิบ → 400 · ไม่ส่ง/ส่งหน่วยเดิม ผ่าน", async () => {
    const ing = await makeIngredient();
    const user = await makeUser();
    const other = await makeUnit();
    const base = { ingredient_id: String(ing._id), type: "receive" as const, qty: 2, performed_by: String(user._id) };
    await expect(txnService.createTransaction({ ...base, unit_id: String(other._id) })).rejects.toMatchObject({ status: 400 });
    await txnService.createTransaction(base);
    await txnService.createTransaction({ ...base, unit_id: String(ing.unit_id) });
    expect((await ingredientModel.findById(ing._id).lean<{ current_stock: number }>())?.current_stock).toBe(4);
  });
});
