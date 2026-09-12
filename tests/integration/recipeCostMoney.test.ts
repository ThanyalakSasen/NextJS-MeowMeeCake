import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import ingredientModel from "@/models/ingredientModel";
import componentModel from "@/models/componentModel";
import recipeModel from "@/models/recipeModel";
import productModel from "@/models/productModel";
import ingredientCategoryModel from "@/models/ingredientCategoryModel";
import componentCategoryModel from "@/models/componentsCategory";
import ingredientService from "@/services/ingredientService";
import componentService from "@/services/componentService";
import recipeService from "@/services/recipeService";
import * as productService from "@/services/productService";
import * as orderService from "@/services/orderService";
import { makeUser, makeUnit, makeProduct } from "./helpers";

/**
 * BACKLOG §3.11 เฟส 4 — ingredientModel.cost_per_unit, componentModel/recipeModel.
 * estimated_cost_per_batch, productModel.purchase_cost เก็บเป็นสตางค์ แต่ API ยังรับ-ส่งบาททศนิยม
 * เหมือนเดิม (รูปแบบเดียวกับเฟส 1-3 — ดู docs/hardening-5-money-phase1.md)
 */

async function makeIngredientCategory() {
  return ingredientCategoryModel.create({ ingredient_category_name: `หมวด-${Date.now()}-${Math.random()}` });
}
async function makeComponentCategory() {
  return componentCategoryModel.create({ component_category_name: `หมวด-${Date.now()}-${Math.random()}` });
}

describe("ingredientService — cost_per_unit เก็บสตางค์ คืนบาท", () => {
  it("create/update: แปลงเป็นสตางค์ก่อนเก็บ คืนกลับเป็นบาท", async () => {
    const cat = await makeIngredientCategory();
    const unit = await makeUnit();

    const created = await ingredientService.create({
      ingredient_name: `แป้ง-${Date.now()}`,
      ingredient_category_id: cat._id,
      unit_id: unit._id,
      cost_per_unit: 12.5,
      reorder_point: 5,
    });
    expect(created.cost_per_unit).toBe(12.5);

    const raw = await ingredientModel.findById(created._id).lean<{ cost_per_unit: number }>();
    expect(raw!.cost_per_unit).toBe(1250);

    const updated = await ingredientService.update(String(created._id), { cost_per_unit: 15 });
    expect(updated.cost_per_unit).toBe(15);
    const rawAfter = await ingredientModel.findById(created._id).lean<{ cost_per_unit: number }>();
    expect(rawAfter!.cost_per_unit).toBe(1500);
  });

  it("list/getById คืนค่าเป็นบาทเสมอ", async () => {
    const cat = await makeIngredientCategory();
    const unit = await makeUnit();
    const created = await ingredientService.create({
      ingredient_name: `น้ำตาล-${Date.now()}`,
      ingredient_category_id: cat._id,
      unit_id: unit._id,
      cost_per_unit: 22.25,
      reorder_point: 5,
    });

    const byId = await ingredientService.getById(String(created._id));
    expect((byId as { cost_per_unit: number }).cost_per_unit).toBe(22.25);

    const { items } = await ingredientService.list({ pagination: { page: 1, limit: 10, skip: 0 } });
    const found = items.find((it) => String((it as { _id: unknown })._id) === String(created._id));
    expect((found as { cost_per_unit: number } | undefined)?.cost_per_unit).toBe(22.25);
  });
});

describe("componentService — estimated_cost_per_batch เก็บสตางค์ คืนบาท", () => {
  it("create: กรอกต้นทุนมือ (บาท) → แปลงเป็นสตางค์", async () => {
    const cat = await makeComponentCategory();
    const unit = await makeUnit();
    const user = await makeUser();

    const created = await componentService.create({
      component_name: `ครีม-${Date.now()}`,
      componentcategory_id: cat._id,
      yield_qty: 1,
      yield_unit_id: unit._id,
      estimated_cost_per_batch: 88.88,
      created_by: user._id,
    });
    expect((created as { estimated_cost_per_batch: number }).estimated_cost_per_batch).toBe(88.88);

    const raw = await componentModel
      .findById((created as { _id: unknown })._id)
      .lean<{ estimated_cost_per_batch: number }>();
    expect(raw!.estimated_cost_per_batch).toBe(8888);
  });

  it("create: ไม่กรอกต้นทุน → คิดอัตโนมัติจาก ingredients (satang ปัดเป็น integer ถูกต้อง)", async () => {
    const cat = await makeComponentCategory();
    const unit = await makeUnit();
    const user = await makeUser();
    const ingCat = await makeIngredientCategory();
    const ingUnit = await makeUnit();

    // cost_per_unit = 9.99 บาท = 999 สตางค์ · quantity = 1.5 → 999*1.5 = 1498.5 → ต้องปัดเป็น 1499
    const ing = await ingredientService.create({
      ingredient_name: `วัตถุดิบ-${Date.now()}`,
      ingredient_category_id: ingCat._id,
      unit_id: ingUnit._id,
      cost_per_unit: 9.99,
      reorder_point: 1,
    });

    const created = await componentService.create({
      component_name: `ไส้-${Date.now()}`,
      componentcategory_id: cat._id,
      yield_qty: 1,
      yield_unit_id: unit._id,
      created_by: user._id,
      ingredients: [{ ingredient_id: idOf(ing), quantity: 1.5, unit_id: ingUnit._id }],
    });

    const raw = await componentModel
      .findById((created as { _id: unknown })._id)
      .lean<{ estimated_cost_per_batch: number }>();
    expect(raw!.estimated_cost_per_batch).toBe(1499); // integer สตางค์ ไม่ใช่ 14.99 หรือ 1498.5

    expect((created as { estimated_cost_per_batch: number }).estimated_cost_per_batch).toBe(14.99);
  });

  it("getExpanded: cost_per_unit ของวัตถุดิบที่ populate มาต้องเป็นบาทด้วย (ไม่ใช่แค่ estimated_cost_per_batch)", async () => {
    const cat = await makeComponentCategory();
    const unit = await makeUnit();
    const user = await makeUser();
    const ingCat = await makeIngredientCategory();
    const ingUnit = await makeUnit();
    const ing = await ingredientService.create({
      ingredient_name: `วัตถุดิบ-${Date.now()}`,
      ingredient_category_id: ingCat._id,
      unit_id: ingUnit._id,
      cost_per_unit: 5,
      reorder_point: 1,
    });

    const created = await componentService.create({
      component_name: `ไส้-${Date.now()}`,
      componentcategory_id: cat._id,
      yield_qty: 1,
      yield_unit_id: unit._id,
      created_by: user._id,
      ingredients: [{ ingredient_id: idOf(ing), quantity: 2, unit_id: ingUnit._id }],
    });

    const expanded = await componentService.getExpanded(String((created as { _id: unknown })._id));
    expect(expanded.estimated_cost_per_batch).toBe(10); // 5*2 บาท
    const populatedIng = expanded.ingredients[0].ingredient_id as { cost_per_unit: number };
    expect(populatedIng.cost_per_unit).toBe(5); // ต้องเป็นบาท ไม่ใช่ 500 สตางค์ดิบ
  });
});

describe("recipeService — estimated_cost_per_batch เก็บสตางค์ คืนบาท", () => {
  it("create: คิดอัตโนมัติจาก ingredients + components รวมกัน", async () => {
    const user = await makeUser();
    const product = await makeProduct();
    const unit = await makeUnit();
    const ingCat = await makeIngredientCategory();
    const ingUnit = await makeUnit();
    const compCat = await makeComponentCategory();
    const compUnit = await makeUnit();

    const ing = await ingredientService.create({
      ingredient_name: `แป้ง-${Date.now()}`,
      ingredient_category_id: ingCat._id,
      unit_id: ingUnit._id,
      cost_per_unit: 10, // 10 บาท = 1000 สตางค์
      reorder_point: 1,
    });
    const comp = await componentService.create({
      component_name: `ครีม-${Date.now()}`,
      componentcategory_id: compCat._id,
      yield_qty: 1,
      yield_unit_id: compUnit._id,
      estimated_cost_per_batch: 20, // 20 บาท = 2000 สตางค์
      created_by: user._id,
    });

    // ingredient: 10 บาท * quantity 3 = 30 บาท · component: 20 บาท (yield_qty 1) * quantity 2 = 40 บาท
    // รวม 70 บาท
    const recipe = await recipeService.create({
      recipe_name: `เค้ก-${Date.now()}`,
      product_id: product._id,
      yield_qty: 1,
      yield_unit_id: unit._id,
      created_by: user._id,
      ingredients: [{ ingredient_id: idOf(ing), quantity: 3, unit_id: ingUnit._id }],
      components: [{ component_id: idOf(comp), quantity: 2, unit_id: compUnit._id }],
    });

    expect((recipe as { estimated_cost_per_batch: number }).estimated_cost_per_batch).toBe(70);
    const raw = await recipeModel
      .findById((recipe as { _id: unknown })._id)
      .lean<{ estimated_cost_per_batch: number }>();
    expect(raw!.estimated_cost_per_batch).toBe(7000);
  });

  it("getExpanded: presenting ครบทั้ง ingredients.ingredient_id.cost_per_unit และ components.component_id.estimated_cost_per_batch", async () => {
    const user = await makeUser();
    const product = await makeProduct();
    const unit = await makeUnit();
    const ingCat = await makeIngredientCategory();
    const ingUnit = await makeUnit();
    const compCat = await makeComponentCategory();
    const compUnit = await makeUnit();

    const ing = await ingredientService.create({
      ingredient_name: `แป้ง-${Date.now()}`,
      ingredient_category_id: ingCat._id,
      unit_id: ingUnit._id,
      cost_per_unit: 8,
      reorder_point: 1,
    });
    const comp = await componentService.create({
      component_name: `ครีม-${Date.now()}`,
      componentcategory_id: compCat._id,
      yield_qty: 1,
      yield_unit_id: compUnit._id,
      estimated_cost_per_batch: 12,
      created_by: user._id,
    });
    const recipe = await recipeService.create({
      recipe_name: `เค้ก-${Date.now()}`,
      product_id: product._id,
      yield_qty: 1,
      yield_unit_id: unit._id,
      created_by: user._id,
      ingredients: [{ ingredient_id: idOf(ing), quantity: 1, unit_id: ingUnit._id }],
      components: [{ component_id: idOf(comp), quantity: 1, unit_id: compUnit._id }],
    });

    const expanded = await recipeService.getExpanded(String((recipe as { _id: unknown })._id));
    const popIng = expanded.ingredients[0].ingredient_id as { cost_per_unit: number };
    const popComp = expanded.components[0].component_id as { estimated_cost_per_batch: number };
    expect(popIng.cost_per_unit).toBe(8);
    expect(popComp.estimated_cost_per_batch).toBe(12);
  });
});

describe("productService.purchase_cost — เก็บสตางค์ คืนบาท (BACKLOG §3.11 เฟส 4)", () => {
  it("createProduct/updateProduct: แปลง purchase_cost บาท↔สตางค์ถูกต้อง", async () => {
    const cat = await (await import("@/models/productCategoryModel")).default.create({
      product_category_name: `หมวด-${Date.now()}`,
    });
    const unit = await makeUnit();

    const created = await productService.createProduct({
      product_name_th: "น้ำดื่ม",
      product_name_eng: "Water",
      category_id: String(cat._id),
      product_price: 15,
      unit_id: String(unit._id),
      product_type: "inStore",
      purchase_cost: 8.5,
    });
    expect((created as { purchase_cost: number | null }).purchase_cost).toBe(8.5);

    const raw = await productModel
      .findById((created as { _id: unknown })._id)
      .lean<{ purchase_cost: number | null }>();
    expect(raw!.purchase_cost).toBe(850);

    const updated = await productService.updateProduct(String((created as { _id: unknown })._id), {
      purchase_cost: 9,
    });
    expect((updated as { purchase_cost: number | null }).purchase_cost).toBe(9);
    const rawAfter = await productModel
      .findById((created as { _id: unknown })._id)
      .lean<{ purchase_cost: number | null }>();
    expect(rawAfter!.purchase_cost).toBe(900);
  });

  it("getProductById/getProducts: purchase_cost คืนเป็นบาท, ไม่มีค่า (null) ไม่พัง", async () => {
    const product = await makeProduct({ purchase_cost: null });
    const byId = await productService.getProductById(String(product._id));
    expect((byId as { purchase_cost: number | null }).purchase_cost).toBeNull();

    const withCost = await makeProduct({ purchase_cost: 4200 }); // เขียนตรง (satang) ข้าม service
    const { items } = await productService.getProducts({ limit: 100 });
    const found = items.find((it) => String((it as { _id: unknown })._id) === String(withCost._id));
    expect((found as { purchase_cost: number | null } | undefined)?.purchase_cost).toBe(42);
  });
});

describe("orderService × recipeService — cost_per_unit end-to-end เป็นสตางค์ใน DB คืนบาทใน API (BACKLOG §3.11 เฟส 4)", () => {
  it("สร้างออเดอร์จากสินค้าที่มีสูตร → orderItem.cost_per_unit เก็บสตางค์ คืน API เป็นบาท", async () => {
    const user = await makeUser();
    const product = await makeProduct({ product_price: 100, product_stock_quantity: 10 });
    const unit = await makeUnit();
    const ingCat = await makeIngredientCategory();
    const ingUnit = await makeUnit();
    const compUser = await makeUser();

    const ing = await ingredientService.create({
      ingredient_name: `แป้ง-${Date.now()}`,
      ingredient_category_id: ingCat._id,
      unit_id: ingUnit._id,
      cost_per_unit: 6, // 6 บาท
      reorder_point: 1,
    });
    // สูตร: yield_qty 2, ต้นทุน/แบทช์ = 6*4 = 24 บาท → ต้นทุน/หน่วย = 24/2 = 12 บาท = 1200 สตางค์
    await recipeService.create({
      recipe_name: `สูตร-${Date.now()}`,
      product_id: product._id,
      yield_qty: 2,
      yield_unit_id: unit._id,
      created_by: compUser._id,
      ingredients: [{ ingredient_id: idOf(ing), quantity: 4, unit_id: ingUnit._id }],
    });

    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      items: [{ product_id: String(product._id), quantity: 3 }],
    });

    const rawItem = await (
      await import("@/models/orderItemModel")
    ).default.findOne({ order_id: order._id }).lean<{ cost_per_unit: number }>();
    expect(rawItem!.cost_per_unit).toBe(1200); // สตางค์ดิบใน DB

    const fetched = await orderService.getOrderById(String(order._id));
    expect((fetched.items[0] as { cost_per_unit: number }).cost_per_unit).toBe(12); // บาทจาก API
  });
});

/** helper: ObjectId ที่ mongoose คืนมาจาก .create() บางทีเป็น Document บางทีเป็น lean object — คืน _id ให้ชัวร์ */
function idOf(doc: unknown): mongoose.Types.ObjectId {
  return (doc as { _id: mongoose.Types.ObjectId })._id;
}
