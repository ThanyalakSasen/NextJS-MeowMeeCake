import { describe, it, expect } from "vitest";
import productModel from "@/models/productModel";
import recipeModel from "@/models/recipeModel";
import preorderRoundModel from "@/models/preorderRoundModel";
import preorderRoundItemModel from "@/models/preorderRoundItemModel";
import preorderItemModel from "@/models/preorderItemModel";
import preorderModel from "@/models/preorderModel";
import * as productService from "@/services/productService";
import { ingredientService } from "@/services/ingredientService";
import { recipeService } from "@/services/recipeService";
import { releaseFromRound, releasePreorders, unlinkComponent, unlinkIngredient } from "@/services/deleteBlockerActions";
import productionOrderModel from "@/models/productionOrderModel";
import * as productionItemService from "@/services/productionItemService";
import { componentService } from "@/services/componentService";
import componentModel from "@/models/componentModel";
import { makeUser, makeProduct, makePreorder, makeRecipe, makeIngredient, oid } from "./helpers";

/** modal "ลบยังไม่ได้" — รายการเหตุผล + ปุ่มแก้ทีละข้อ (ผู้ใช้ขอ 2026-10-31) */
async function openRoundWith(productId: unknown, current_qty = 0) {
  const admin = await makeUser();
  const now = Date.now();
  const round = await preorderRoundModel.create({
    created_by: admin._id,
    round_name: `รอบเปิด ${current_qty}`,
    open_date: new Date(now - 86_400_000),
    close_date: new Date(now + 86_400_000),
    pickup_date: new Date(now + 2 * 86_400_000),
    round_status: "open",
  });
  const item = await preorderRoundItemModel.create({ round_id: round._id, product_id: productId, max_qty_total: 10, current_qty });
  return { round, item };
}

describe("สินค้า", () => {
  it("รอบเปิดยังไม่มีคนจอง → remove_from_round → เอาออกจากรอบแล้วลบได้", async () => {
    const p = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    const { item } = await openRoundWith(p._id);
    const blockers = await productService.getDeleteBlockers(String(p._id));
    expect(blockers).toEqual([expect.objectContaining({ kind: "round", ref_id: String(item._id), action: "remove_from_round" })]);
    await expect(productService.deleteProduct(String(p._id))).rejects.toMatchObject({
      status: 409,
      details: { blockers: expect.any(Array) },
    });

    await expect(releaseFromRound(String(p._id), String(item._id))).resolves.toMatchObject({ result: "removed" });
    expect(await productService.getDeleteBlockers(String(p._id))).toEqual([]);
    await expect(productService.deleteProduct(String(p._id))).resolves.toBeTruthy();
  });

  it("รอบเปิดมีคนจองและยังไม่ผลิต → close_round_item ปิดการขาย แต่ออเดอร์ค้างยังกันลบไว้ (ผลิตต่อ)", async () => {
    const p = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    const { round, item } = await openRoundWith(p._id, 2);
    const user = await makeUser();
    const po = await makePreorder(String(user._id), { round_id: round._id, order_status: "confirmed" });
    await preorderItemModel.create({
      preorder_id: po._id,
      round_item_id: item._id,
      product_id: p._id,
      product_snapshot: { product_name_th: "เค้ก", product_name_eng: "Cake" },
      pickup_date: new Date(),
      quantity: 2,
      unit_price: 50,
      total_price: 100,
    });

    const before = await productService.getDeleteBlockers(String(p._id));
    expect(before.map((b) => [b.kind, b.action])).toEqual([["round", "close_round_item"], ["preorders", "release_preorders"]]);

    await expect(releaseFromRound(String(p._id), String(item._id))).resolves.toMatchObject({ result: "closed" });
    const ri = await preorderRoundItemModel.findById(item._id).lean<{ is_active: boolean; deleted_at: Date | null }>();
    expect(ri).toMatchObject({ is_active: false, deleted_at: null });
    expect(await preorderModel.findById(po._id).lean()).toMatchObject({ order_status: "confirmed" });

    const after = await productService.getDeleteBlockers(String(p._id));
    expect(after).toEqual([expect.objectContaining({ kind: "preorders", qty: 1, action: "release_preorders" })]);

    await preorderModel.updateOne({ _id: po._id }, { $set: { order_status: "ready" } });
    await expect(productService.deleteProduct(String(p._id))).resolves.toBeTruthy();
  });

  it("มีออเดอร์ค้าง → release_preorders ยกเลิกสินค้าในรอบ ลบสินค้าได้ · ออเดอร์/ใบผลิตของรอบยังอยู่และผลิตต่อได้", async () => {
    const p = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    const { round, item } = await openRoundWith(p._id, 2);
    await preorderRoundModel.updateOne({ _id: round._id }, { $set: { round_status: "closed" } });
    const user = await makeUser();
    const po = await makePreorder(String(user._id), { round_id: round._id, order_status: "confirmed" });
    await preorderItemModel.create({
      preorder_id: po._id,
      round_item_id: item._id,
      product_id: p._id,
      product_snapshot: { product_name_th: "เค้ก", product_name_eng: "Cake" },
      pickup_date: new Date(),
      quantity: 2,
      unit_price: 50,
      total_price: 100,
    });
    const recipe = await makeRecipe(String(p._id));
    const order = await productionOrderModel.create({
      production_no: `PO-T-${Date.now()}`,
      production_date: new Date(),
      source_type: "preorder",
      round_id: round._id,
      production_status: "planned",
    });
    await productionItemService.addItems(String(order._id), [
      { product_id: String(p._id), recipe_id: String(recipe._id), planned_qty: 2, round_item_id: String(item._id) },
    ]);

    const before = await productService.getDeleteBlockers(String(p._id));
    expect(before.map((b) => [b.kind, b.action])).toEqual([
      ["preorders", "release_preorders"],
      ["production", null],
    ]);
    expect(before[0].ref_id).toBe(String(item._id));

    await expect(releasePreorders(String(p._id), String(item._id))).resolves.toMatchObject({ result: "released" });
    expect(await productService.getDeleteBlockers(String(p._id))).toEqual([]);
    await expect(productService.deleteProduct(String(p._id))).resolves.toBeTruthy();

    expect(await preorderModel.findById(po._id).lean()).toMatchObject({ order_status: "confirmed" });
    expect(await preorderRoundItemModel.findById(item._id).lean()).toMatchObject({ is_active: false, deleted_at: null });
    // สินค้าถูกลบแล้วยังเพิ่มรายการผลิตจากรอบได้ (ใบผลิตทั่วไปไม่ได้)
    const order2 = await productionOrderModel.create({ production_no: `PO-T2-${Date.now()}`, production_date: new Date(), source_type: "manual", production_status: "planned" });
    await expect(
      productionItemService.addItems(String(order2._id), [{ product_id: String(p._id), recipe_id: String(recipe._id), planned_qty: 1, round_item_id: String(item._id) }]),
    ).resolves.toBeTruthy();
    await expect(
      productionItemService.addItems(String(order2._id), [{ product_id: String(p._id), recipe_id: String(recipe._id), planned_qty: 1 }]),
    ).rejects.toThrow(/ไม่พบสินค้า/);
  });

  it("สต็อกเหลือ → blocker stock ไม่มีปุ่ม", async () => {
    const p = await makeProduct({ product_stock_quantity: 4 });
    expect(await productService.getDeleteBlockers(String(p._id))).toEqual([
      expect.objectContaining({ kind: "stock", qty: 4, action: null }),
    ]);
  });
});

describe("วัตถุดิบ", () => {
  it("สูตรใช้อยู่ → unlink_recipe เอาออก (หักต้นทุนเฉพาะตัวนั้น) แล้วลบได้", async () => {
    const product = await makeProduct();
    const flour = await makeIngredient({ current_stock: 0, cost_per_unit: 2 });
    const sugar = await makeIngredient({ current_stock: 0, cost_per_unit: 1 });
    const recipe = await makeRecipe(String(product._id), {
      ingredients: [
        { ingredient_id: flour._id, quantity: 10, unit_id: flour.unit_id },
        { ingredient_id: sugar._id, quantity: 5, unit_id: sugar.unit_id },
      ],
      estimated_cost_per_batch: 25,
    });

    const blockers = await ingredientService.getDeleteBlockers(String(flour._id));
    expect(blockers).toEqual([expect.objectContaining({ kind: "recipe", ref_id: String(recipe._id), action: "unlink_recipe" })]);

    await unlinkIngredient(String(flour._id), "recipe", String(recipe._id));
    const r = await recipeModel.findById(recipe._id).lean<{ ingredients: Array<{ ingredient_id: unknown }>; estimated_cost_per_batch: number }>();
    expect(r?.ingredients.map((i) => String(i.ingredient_id))).toEqual([String(sugar._id)]);
    expect(r?.estimated_cost_per_batch).toBe(5);

    expect(await ingredientService.getDeleteBlockers(String(flour._id))).toEqual([]);
    await expect(ingredientService.remove(String(flour._id))).resolves.toBeTruthy();
  });
});

describe("สูตร", () => {
  it("สูตรสุดท้ายของสินค้า → unlink_product ลบได้ · สินค้ายังอยู่", async () => {
    const product = await makeProduct();
    const recipe = await makeRecipe(String(product._id));
    expect(await recipeService.getDeleteBlockers(String(recipe._id))).toEqual([
      expect.objectContaining({ kind: "product", ref_id: String(product._id), action: "unlink_product" }),
    ]);
    await expect(recipeService.remove(String(recipe._id))).rejects.toMatchObject({ status: 409 });
    await expect(recipeService.remove(String(recipe._id), { allowLastRecipe: true })).resolves.toBeTruthy();
    expect(await productModel.findById(product._id).lean()).toMatchObject({ deleted_at: null });
  });
});

describe("ส่วนประกอบ", () => {
  it("สูตรหลักใช้อยู่ → unlink_parent_recipe เอาออก (หักต้นทุนเฉพาะส่วนนั้น) แล้วลบได้", async () => {
    const product = await makeProduct();
    const comp = await componentModel.create({
      component_name: "ครีมทดสอบ",
      componentcategory_id: oid(),
      yield_qty: 10,
      yield_unit_id: oid(),
      estimated_cost_per_batch: 50,
      created_by: oid(),
    });
    const recipe = await makeRecipe(String(product._id), {
      components: [{ component_id: comp._id, quantity: 2, unit_id: oid() }],
      estimated_cost_per_batch: 30,
    });

    expect(await componentService.getDeleteBlockers(String(comp._id))).toEqual([
      expect.objectContaining({ kind: "parent_recipe", ref_id: String(recipe._id), action: "unlink_parent_recipe" }),
    ]);
    await expect(componentService.remove(String(comp._id))).rejects.toMatchObject({ status: 409 });

    await unlinkComponent(String(comp._id), String(recipe._id));
    const r = await recipeModel.findById(recipe._id).lean<{ components: unknown[]; estimated_cost_per_batch: number }>();
    expect(r?.components).toEqual([]);
    expect(r?.estimated_cost_per_batch).toBe(20);
    await expect(componentService.remove(String(comp._id))).resolves.toBeTruthy();
  });
});
