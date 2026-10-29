import { describe, it, expect } from "vitest";
import componentModel from "@/models/componentModel";
import * as productionItemService from "@/services/productionItemService";
import { makeProduct, makeRecipe, makeIngredient, oid } from "./helpers";

/**
 * ฟอร์มสร้างแผนการผลิต — เช็ควัตถุดิบพอไหมก่อนบันทึก (checkIngredientStock)
 * คิดแบบเดียวกับ consumeStock: (วัตถุดิบในสูตร + ส่วนประกอบ) ÷ yield_qty × จำนวนที่ผลิต เทียบ current_stock
 */
async function recipeUsing(lines: Array<{ ingredient: { _id: unknown; unit_id: unknown }; qty: number }>, over: Record<string, unknown> = {}) {
  const product = await makeProduct();
  return makeRecipe(String(product._id), {
    yield_qty: 10,
    ingredients: lines.map((l) => ({ ingredient_id: l.ingredient._id, quantity: l.qty, unit_id: l.ingredient.unit_id })),
    ...over,
  });
}

describe("productionItemService.checkIngredientStock", () => {
  it("แถวเดียว: บอกวัตถุดิบที่ไม่พอ + คงเหลือ + ขาดเท่าไหร่ + ผลิตได้สูงสุด", async () => {
    const flour = await makeIngredient({ ingredient_name: "แป้ง", current_stock: 300 });
    const egg = await makeIngredient({ ingredient_name: "ไข่", current_stock: 4 });
    const sugar = await makeIngredient({ ingredient_name: "น้ำตาล", current_stock: 1000 });
    // 10 ชิ้นใช้ แป้ง 500 · ไข่ 10 · น้ำตาล 100 → ชิ้นละ 50 / 1 / 10
    const recipe = await recipeUsing([
      { ingredient: flour, qty: 500 },
      { ingredient: egg, qty: 10 },
      { ingredient: sugar, qty: 100 },
    ]);

    const res = await productionItemService.checkIngredientStock([{ recipe_id: String(recipe._id), planned_qty: 10 }]);
    const row = res.items[0];
    expect(row.can_produce).toBe(false);
    expect(row.max_qty).toBe(4); // ไข่ 4 ฟอง = 4 ชิ้น (แป้งพอ 6)
    expect(row.shortages.map((s) => s.ingredient_name).sort()).toEqual(["แป้ง", "ไข่"]);
    expect(row.shortages.find((s) => s.ingredient_name === "แป้ง")).toMatchObject({ required: 500, in_stock: 300, missing: 200 });
    expect(row.shortages[0].unit_abbr).toBeTruthy();
    expect(res.can_produce_all).toBe(false);

    const ok = await productionItemService.checkIngredientStock([{ recipe_id: String(recipe._id), planned_qty: 4 }]);
    expect(ok.items[0]).toMatchObject({ can_produce: true, shortages: [] });
    expect(ok.can_produce_all).toBe(true);
  });

  it("หลายแถวใช้วัตถุดิบร่วม: แต่ละแถวพอ แต่รวมกันไม่พอ → total_shortages", async () => {
    const butter = await makeIngredient({ ingredient_name: "เนย", current_stock: 150 });
    const a = await recipeUsing([{ ingredient: butter, qty: 100 }]); // ชิ้นละ 10
    const b = await recipeUsing([{ ingredient: butter, qty: 100 }]);

    const res = await productionItemService.checkIngredientStock([
      { recipe_id: String(a._id), planned_qty: 10 },
      { recipe_id: String(b._id), planned_qty: 10 },
    ]);
    expect(res.items.every((i) => i.can_produce)).toBe(true);
    expect(res.total_shortages).toEqual([expect.objectContaining({ ingredient_name: "เนย", required: 200, in_stock: 150, missing: 50 })]);
    expect(res.can_produce_all).toBe(false);
  });

  it("กางส่วนประกอบ (component) ในสูตร · สูตรไม่มีวัตถุดิบ = ไม่จำกัด · ไม่พบสูตร = recipe_invalid", async () => {
    const cream = await makeIngredient({ ingredient_name: "ครีม", current_stock: 50 });
    const comp = await componentModel.create({
      component_name: `วิปครีม-${Date.now()}`,
      componentcategory_id: oid(),
      yield_qty: 2,
      yield_unit_id: oid(),
      estimated_cost_per_batch: 0,
      created_by: oid(),
      ingredients: [{ ingredient_id: cream._id, quantity: 100, unit_id: cream.unit_id }],
    });
    // สูตร 10 ชิ้นใช้วิปครีม 1 หน่วย = ครึ่งแบทช์ = ครีม 50 → ชิ้นละ 5
    const product = await makeProduct();
    const recipe = await makeRecipe(String(product._id), {
      yield_qty: 10,
      components: [{ component_id: comp._id, quantity: 1, unit_id: oid() }],
    });
    const plain = await makeRecipe(String((await makeProduct())._id));

    const res = await productionItemService.checkIngredientStock([
      { recipe_id: String(recipe._id), planned_qty: 12 },
      { recipe_id: String(plain._id), planned_qty: 5 },
      { recipe_id: String(oid()), planned_qty: 1 },
    ]);
    expect(res.items[0]).toMatchObject({ can_produce: false, max_qty: 10 });
    expect(res.items[0].shortages[0]).toMatchObject({ ingredient_name: "ครีม", required: 60, in_stock: 50, missing: 10 });
    expect(res.items[1]).toMatchObject({ can_produce: true, max_qty: null });
    expect(res.items[2]).toMatchObject({ recipe_invalid: true, can_produce: false });
  });
});
