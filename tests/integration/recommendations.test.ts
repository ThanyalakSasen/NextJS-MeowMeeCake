import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import roleModel from "@/models/roleModel";
import * as recommendationService from "@/services/recommendation/recommendationService";
import { makeUser, makeProduct, makeIngredient, makeRecipe } from "./helpers";

/** แนะนำสินค้า · สินค้าคล้ายกัน · ตรวจสารก่อภูมิแพ้ (customer-backend-merge.md §8.15) */

async function customer(allergies: string[] = []) {
  const role = await roleModel.create({ role_name: `customer-${Math.random()}`, role_type: "customer" });
  return makeUser({ role_id: role._id, user_allergies: allergies });
}

/** เค้ก 3 ชิ้น หมวดเดียวกัน — ชิ้นหนึ่งมีนมสดในสูตร */
async function catalog() {
  const category_id = new mongoose.Types.ObjectId();
  const milk = await makeIngredient({ ingredient_name: `นมสด-${Math.random()}` });
  const flour = await makeIngredient({ ingredient_name: `แป้ง-${Math.random()}` });
  const withMilk = await makeProduct({ product_name_th: "เค้กนมสด", category_id, product_price: 120, avg_rating: 4.8 });
  const plain = await makeProduct({ product_name_th: "เค้กช็อกโกแลต", category_id, product_price: 130, avg_rating: 4.5 });
  const other = await makeProduct({ product_name_th: "บราวนี่", category_id, product_price: 90, avg_rating: 3.9 });
  const hidden = await makeProduct({ product_name_th: "ซ่อนไว้", category_id, is_visible: false, avg_rating: 5 });
  const recipeItem = (ing: { _id: unknown; unit_id: unknown }) => ({ ingredient_id: ing._id, quantity: 1, unit_id: ing.unit_id });
  await makeRecipe(String(withMilk._id), { ingredients: [recipeItem(milk), recipeItem(flour)] });
  await makeRecipe(String(plain._id), { ingredients: [recipeItem(flour)] });
  await makeRecipe(String(other._id), { ingredients: [recipeItem(flour)] });
  return { withMilk, plain, other, hidden, milk };
}

describe("แนะนำสินค้า", () => {
  it("ไม่ล็อกอิน → เรียงตามคะแนนรีวิว ไม่รวมสินค้าที่ซ่อน", async () => {
    const { withMilk, hidden } = await catalog();
    const { products } = await recommendationService.recommendedProducts(null);
    const ids = products.map((p) => String(p._id));
    expect(ids[0]).toBe(String(withMilk._id));
    expect(ids).not.toContain(String(hidden._id));
    expect(typeof products[0].avg_rating).toBe("number");
  });

  it("ล็อกอิน + แพ้นม → สินค้าที่มีนมได้คำเตือน · excludeAllergens ตัดออก", async () => {
    const { withMilk, plain } = await catalog();
    const user = await customer(["นม"]);
    const all = await recommendationService.personalized({
      userId: String(user._id), limit: 10, strategy: "hybrid", excludeAllergens: false,
    });
    const milkRec = all.recommendations.find((r) => String(r.product._id) === String(withMilk._id));
    expect(milkRec?.allergenWarning?.level).toBeTruthy();
    expect(milkRec?.allergenWarning?.level).not.toBe("none");
    const plainRec = all.recommendations.find((r) => String(r.product._id) === String(plain._id));
    expect(plainRec?.allergenWarning?.level ?? "none").toBe("none");

    const safe = await recommendationService.personalized({
      userId: String(user._id), limit: 10, strategy: "hybrid", excludeAllergens: true,
    });
    expect(safe.recommendations.map((r) => String(r.product._id))).not.toContain(String(withMilk._id));
  });

  it("สินค้าคล้ายกัน: ไม่รวมตัวเอง · สินค้าไม่มี = 404 · วัตถุดิบสาธารณะส่งแค่ชื่อ", async () => {
    const { plain, milk } = await catalog();
    const { recommendations } = await recommendationService.similar(String(plain._id), 6);
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.map((r) => String(r.product._id))).not.toContain(String(plain._id));
    await expect(recommendationService.similar(String(new mongoose.Types.ObjectId()), 6)).rejects.toMatchObject({ status: 404 });

    const { ingredients } = await recommendationService.publicIngredients();
    const row = ingredients.find((i) => String(i._id) === String(milk._id)) as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["_id", "ingredient_name"]);
  });
});
