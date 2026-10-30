import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import ingredientModel from "@/models/ingredientModel";
import * as productService from "@/services/productService";
import { ingredientService } from "@/services/ingredientService";
import { makeProduct, makeIngredient } from "./helpers";

/** ยังมีของในสต็อก = ลบสินค้า/วัตถุดิบไม่ได้ (ผู้ใช้ขอ 2026-10-30) — ต้องขายหมด/ใช้หมด หรือปรับสต็อกเป็น 0 ก่อน */
const deletedAt = async (model: typeof productModel | typeof ingredientModel, id: unknown) =>
  (await (model as typeof productModel).findById(id).lean<{ deleted_at: Date | null }>())?.deleted_at;

describe("ลบสินค้า", () => {
  it("ยังมีสต็อก → 409 ทั้งลบปกติและลบถาวร · สต็อก 0 → ลบได้", async () => {
    const p = await makeProduct({ product_stock_quantity: 3 });
    await expect(productService.deleteProduct(String(p._id))).rejects.toMatchObject({ status: 409 });
    await expect(productService.hardDeleteProduct(String(p._id))).rejects.toMatchObject({ status: 409 });
    expect(await deletedAt(productModel, p._id)).toBeNull();

    await productModel.updateOne({ _id: p._id }, { $set: { product_stock_quantity: 0 } });
    await productService.deleteProduct(String(p._id));
    expect(await deletedAt(productModel, p._id)).not.toBeNull();
  });

  it("พรีออเดอร์ (ไม่มีสต็อก) → ลบได้", async () => {
    const p = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    await expect(productService.deleteProduct(String(p._id))).resolves.toBeTruthy();
  });
});

describe("ลบวัตถุดิบ", () => {
  it("ยังมียอดคงเหลือ → 409 · ยอด 0 → ลบได้", async () => {
    const ing = await makeIngredient({ current_stock: 250 });
    await expect(ingredientService.remove(String(ing._id))).rejects.toMatchObject({ status: 409 });
    expect(await deletedAt(ingredientModel, ing._id)).toBeNull();

    await ingredientModel.updateOne({ _id: ing._id }, { $set: { current_stock: 0 } });
    await ingredientService.remove(String(ing._id));
    expect(await deletedAt(ingredientModel, ing._id)).not.toBeNull();
  });
});
