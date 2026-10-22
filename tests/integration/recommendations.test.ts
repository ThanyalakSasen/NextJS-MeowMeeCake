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

  it("ล็อกอิน + แพ้นม → ไม่แนะนำสินค้าที่มีนม ทั้งแนะนำเฉพาะตัว · หน้าแรก · สินค้าคล้ายกัน", async () => {
    const { withMilk, plain, other } = await catalog();
    const user = await customer(["นม"]);
    const uid = String(user._id);
    const milkId = String(withMilk._id);

    const mine = await recommendationService.personalized({ userId: uid, limit: 10, strategy: "hybrid" });
    const mineIds = mine.recommendations.map((r) => String(r.product._id));
    expect(mineIds).not.toContain(milkId);
    expect(mineIds).toContain(String(plain._id));
    expect(mine.recommendations.every((r) => r.allergenWarning === null)).toBe(true);

    const popular = await recommendationService.personalized({ userId: uid, limit: 10, strategy: "popular" });
    expect(popular.recommendations.map((r) => String(r.product._id))).not.toContain(milkId);

    const home = await recommendationService.recommendedProducts(uid);
    expect(home.products.map((p) => String(p._id))).not.toContain(milkId);

    const similar = await recommendationService.similar(String(other._id), 6, uid);
    expect(similar.recommendations.map((r) => String(r.product._id))).not.toContain(milkId);
    // ไม่ล็อกอิน = ไม่มีข้อมูลการแพ้ → ยังแนะนำได้
    const guestSimilar = await recommendationService.similar(String(other._id), 6);
    expect(guestSimilar.recommendations.map((r) => String(r.product._id))).toContain(milkId);
  });

  it("คำเตือนแพ้อาหารของทุกสินค้า: เฉพาะสินค้าที่มีวัตถุดิบที่แพ้ · ไม่บันทึกอาหารที่แพ้ = ว่าง", async () => {
    const { withMilk, plain } = await catalog();
    const allergic = await customer(["นม"]);
    const { warnings } = await recommendationService.allergenWarnings(String(allergic._id));
    expect(warnings[String(withMilk._id)]?.level).toBe("warning");
    expect(warnings[String(withMilk._id)]?.matchedAllergens.map((m) => m.name)).toEqual(["นม"]);
    expect(warnings[String(plain._id)]).toBeUndefined();

    const none = await customer();
    expect((await recommendationService.allergenWarnings(String(none._id))).warnings).toEqual({});
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
