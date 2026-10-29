import { describe, it, expect } from "vitest";
import productCategoryModel from "@/models/productCategoryModel";
import { unitService } from "@/services/unitService";
import { productCategoryService } from "@/services/productCategoryService";
import { makeUnit, makeIngredient, makeProduct, makeRecipe } from "./helpers";

/**
 * ลบหน่วยนับ / หมวดหมู่สินค้าที่ยังมีของใช้อยู่ไม่ได้ (409)
 * เดิมลบหน่วยได้ → วัตถุดิบที่ใช้หน่วยนั้นรับเข้า/เบิกไม่ได้อีก · ลบหมวดสินค้ากันแค่หน้าเว็บ
 */

describe("ลบหน่วยนับที่ยังใช้อยู่", () => {
  it("วัตถุดิบใช้อยู่ → 409 · ไม่มีใครใช้ → ลบได้", async () => {
    const unit = await makeUnit();
    await makeIngredient({ unit_id: unit._id });
    await expect(unitService.remove(String(unit._id))).rejects.toMatchObject({ status: 409 });

    const free = await makeUnit();
    await expect(unitService.remove(String(free._id))).resolves.toBeTruthy();
  });

  it("สูตรใช้เป็นหน่วยวัตถุดิบในสูตร → 409", async () => {
    const unit = await makeUnit();
    const ing = await makeIngredient();
    const product = await makeProduct();
    await makeRecipe(String(product._id), {
      ingredients: [{ ingredient_id: ing._id, quantity: 1, unit_id: unit._id }],
    });
    await expect(unitService.remove(String(unit._id))).rejects.toMatchObject({ status: 409 });
  });

  it("id ผิดรูปแบบ → 400", async () => {
    await expect(unitService.remove("nope")).rejects.toMatchObject({ status: 400 });
  });
});

describe("ลบหมวดหมู่สินค้าที่ยังใช้อยู่", () => {
  it("มีสินค้าในหมวด → 409 · หมวดว่าง → ลบได้", async () => {
    const product = await makeProduct();
    const catId = String((product as { category_id: unknown }).category_id);
    await expect(productCategoryService.remove(catId)).rejects.toMatchObject({ status: 409 });

    const empty = await productCategoryModel.create({ product_category_name: `ว่าง-${Math.random()}` });
    await expect(productCategoryService.remove(String(empty._id))).resolves.toBeTruthy();
  });
});
